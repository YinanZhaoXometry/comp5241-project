"""Stdin/stdout only. Trusted entrypoint; never interpret document instructions.

XML uses namespace-aware streaming libxml2 with DTD/entities forbidden. ZIP members
are streamed, never extracted. Hard cgroup/rlimit/seccomp limits are set outside
this process; these format checks are not a substitute for that isolation.
"""
import io
import json
import logging
import os
import resource
import socket
import struct
import sys
import time
import zipfile
from lxml import etree

MAX = 20 * 1024 * 1024
META = 256 * 1024
WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
STRICT_WORD = "http://purl.oclc.org/ooxml/wordprocessingml/main"
RELS = "http://schemas.openxmlformats.org/package/2006/relationships"
TYPES = "http://schemas.openxmlformats.org/package/2006/content-types"


class Rejected(Exception):
    pass


def reject(reason):
    raise Rejected(reason)


def frame(meta, text=b""):
    header = json.dumps(meta, ensure_ascii=True, separators=(",", ":")).encode()
    if len(header) > META or len(text) > MAX:
        reject("resource")
    sys.stdout.buffer.write(struct.pack(">I", len(header)))
    sys.stdout.buffer.write(header)
    sys.stdout.buffer.write(text)


class Output:
    def __init__(self):
        self.parts = []
        self.size = 0
        self.locations = []

    def append(self, text):
        value = text.encode("utf-8", errors="strict")
        if self.size + len(value) > MAX:
            reject("resource")
        self.parts.append(value)
        self.size += len(value)

    def location(self, unit, source, first, start):
        if len(self.locations) >= 2048 or len(source) > 200:
            reject("resource")
        self.locations.append(dict(unit=unit, source=source, first=first, last=first, start=start, end=self.size))


def xml_parser(start, end, text):
    # Target+feed builds no tree. Never enable DTD/schema/XInclude/XSLT or
    # huge_tree. Source: https://lxml.de/parsing.html#the-target-parser-interface
    def name(value):
        return value[1:].replace("}", "|", 1) if value.startswith("{") else value

    class Target:
        def start(self, tag, attrs):
            if tag.startswith("{http://www.w3.org/2001/XInclude}"):
                reject("unsafe")
            start(name(tag), {name(key): value for key, value in attrs.items()})

        def end(self, tag):
            end(name(tag))

        def data(self, value):
            text(value)

        def doctype(self, *_args):
            reject("unsafe")

        def pi(self, *_args):
            reject("unsafe")

        def close(self):
            pass

    class DenyResources(etree.Resolver):
        def resolve(self, *_args):
            reject("unsafe")  # None would permit the default filesystem resolver.

    parser = etree.XMLParser(target=Target(), load_dtd=False, dtd_validation=False,
                             attribute_defaults=False, resolve_entities=False,
                             no_network=True, decompress=False, recover=False,
                             huge_tree=False, collect_ids=False, remove_pis=False)
    parser.resolvers.add(DenyResources())
    return parser


def word_document(data, out):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        reject("unsupported")
    with archive:
        members = archive.infolist()
        if len(members) > 2048:
            reject("resource")
        names = set()
        for member in members:
            name = member.filename
            if (not name or len(name) > 200 or name.startswith("/") or "\\" in name or ":" in name
                    or any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))
                    or any(ord(c) < 32 for c in name) or name.casefold() in names
                    or (member.external_attr >> 16) & 0o170000 == 0o120000):
                reject("unsafe")
            names.add(name.casefold())
            if member.flag_bits & 1:
                reject("protected")
            if member.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                reject("unsupported")
            if any(token in name.casefold() for token in ("vbaproject", "embeddings/", "activex/", "oleobject")):
                reject("unsafe")
        if "word/document.xml" not in names or "[content_types].xml" not in names:
            reject("unsupported")
        total = 0
        main_type = False
        paragraph = 0
        in_text = 0
        paragraph_start = 0
        root_seen = False
        for member in members:
            is_main = member.filename == "word/document.xml"
            depth = 0

            def start(name, attrs):
                nonlocal main_type, paragraph, in_text, paragraph_start, root_seen, depth
                depth += 1
                if depth > 128:
                    reject("resource")
                if member.filename == "[Content_Types].xml" and name == TYPES + "|Override":
                    content_type = attrs.get("ContentType", "")
                    if any(token in content_type.casefold() for token in ("macro", "oleobject", "activex")):
                        reject("unsafe")
                    if attrs.get("PartName") == "/word/document.xml" and content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml":
                        main_type = True
                if name == RELS + "|Relationship":
                    target = attrs.get("Target", "")
                    if attrs.get("TargetMode", "").casefold() == "external" or ":" in target or target.startswith(("/", "\\")):
                        reject("unsafe")
                if not is_main:
                    return
                if depth == 1:
                    if name not in (WORD + "|document", STRICT_WORD + "|document"):
                        reject("corrupt")
                    root_seen = True
                if name in (WORD + "|p", STRICT_WORD + "|p"):
                    paragraph += 1
                    paragraph_start = out.size
                if name in (WORD + "|t", STRICT_WORD + "|t"):
                    in_text += 1
                if name in (WORD + "|tab", STRICT_WORD + "|tab"):
                    out.append("\t")
                if name in (WORD + "|br", STRICT_WORD + "|br"):
                    out.append("\n")

            def end(name):
                nonlocal depth, in_text
                if is_main:
                    if name in (WORD + "|t", STRICT_WORD + "|t"):
                        in_text -= 1
                    if name in (WORD + "|p", STRICT_WORD + "|p"):
                        out.append("\n")
                        out.location("paragraph", member.filename, paragraph, paragraph_start)
                depth -= 1

            def text(value):
                if is_main and in_text:
                    out.append(value)

            parser = xml_parser(start, end, text) if member.filename.endswith((".xml", ".rels")) else None
            size = 0
            with archive.open(member) as source:
                while chunk := source.read(65536):
                    size += len(chunk)
                    total += len(chunk)
                    if size > 32 * 1024 * 1024 or total > 64 * 1024 * 1024:
                        reject("resource")
                    if parser:
                        parser.feed(chunk)
            if parser:
                parser.close()
        if not main_type or not root_seen:
            reject("unsupported")


def pdf_document(data, out):
    from pypdf import PdfReader
    # Library warnings must never disclose content or paths through stderr.
    logging.disable(logging.CRITICAL)
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted:
        reject("protected")  # Includes empty-password encryption; never decrypt.
    if len(reader.pages) > 2048:
        reject("resource")
    for index, page in enumerate(reader.pages):
        start = out.size
        out.append(page.extract_text())
        out.append("\n")
        out.location("page", "PDF", index + 1, start)


def extract(data, kind):
    out = Output()
    warnings = []
    if kind in ("txt", "md"):
        if data.startswith((b"%PDF-", b"PK\x03\x04")):
            reject("unsupported")
        value = data.decode("utf-8-sig" if data.startswith(b"\xef\xbb\xbf") else "utf-8", errors="strict")
        if any((ord(c) < 32 and c not in "\t\r\n") or 127 <= ord(c) <= 159 for c in value):
            reject("corrupt")
        # Preserve literal bytes, including BOM. No Markdown rendering or fetch.
        out.append(data.decode("utf-8"))
        out.location("lines", "UTF-8 source", 1, 0)
        out.locations[0]["last"] = max(1, value.count("\n") + 1)
        if kind == "md":
            warnings = ["literal-markdown"]
    elif kind == "docx":
        if not data.startswith(b"PK\x03\x04"):
            reject("unsupported")
        word_document(data, out)
        warnings = ["layout-omitted", "nontext-omitted", "other-parts-omitted"]
    elif kind == "pdf":
        if not data.startswith(b"%PDF-"):
            reject("unsupported")
        pdf_document(data, out)
        warnings = ["layout-omitted", "nontext-omitted"]
    else:
        reject("unsupported")
    value = b"".join(out.parts)
    if not value.decode("utf-8").strip():
        reject("no-text")
    return dict(format=kind, parser="bounded-documents-v2", warnings=warnings, locations=out.locations), value


def probe(kind):
    if kind == "xmp-policy":
        import importlib.util
        from pypdf import PdfReader, PdfWriter
        from pypdf.errors import PdfReadError
        from pypdf.generic import DictionaryObject, NameObject, StreamObject
        from pypdf.xmp import XmpInformation
        checks = dict(dataRead=False)

        class UnreadableMetadata(StreamObject):
            def get_data(self):
                checks["dataRead"] = True
                raise RuntimeError("Metadata must never be decoded")

        metadata = UnreadableMetadata()
        dictionary = DictionaryObject({NameObject("/Metadata"): metadata})
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer._root_object[NameObject("/Metadata")] = metadata
        output = io.BytesIO()
        writer.write(output)
        reader = PdfReader(io.BytesIO(output.getvalue()), strict=True)
        for label, action in {
            "constructorBlocked": lambda: XmpInformation(metadata),
            "createBlocked": XmpInformation.create,
            "dictionaryBlocked": lambda: dictionary.xmp_metadata,
            "writerBlocked": lambda: writer.xmp_metadata,
            "readerBlocked": lambda: reader.xmp_metadata,
        }.items():
            try:
                action()
                checks[label] = False
            except PdfReadError as error:
                checks[label] = str(error) == "XMP interpretation disabled by document extractor policy"
        checks["expatImportable"] = importlib.util.find_spec("pyexpat") is not None
        with open("/proc/self/maps", encoding="utf-8") as source:
            checks["expatLoaded"] = "expat" in source.read().casefold()
        print(json.dumps(checks))
        return
    if kind == "encrypted-pdf":
        from pypdf import PdfWriter
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.encrypt(user_password="", owner_password="synthetic-owner-only")
        output = io.BytesIO()
        writer.write(output)
        sys.stdout.buffer.write(output.getvalue())
        return
    if kind == "memory":
        blocks = []
        while True:
            blocks.append(bytearray(16 * 1024 * 1024))
    if kind == "cpu":
        while True:
            pass
    if kind == "wall":
        time.sleep(90)
    if kind == "output":
        while True:
            sys.stdout.buffer.write(b"x" * 65536)
    if kind == "versions":
        import hashlib
        import importlib.util
        from pathlib import Path
        import zlib
        import pypdf
        from pypdf import xmp
        expat_importable = importlib.util.find_spec("pyexpat") is not None
        unavailable = []
        for module in ("pyexpat", "_elementtree", "xml.parsers.expat", "xml.dom.expatbuilder"):
            try:
                __import__(module)
            except ImportError:
                unavailable.append(module)
        with open("/proc/self/maps", encoding="utf-8") as source:
            expat_loaded = "expat" in source.read().casefold()
        with open(xmp.__file__, "rb") as source:
            xmp_hash = hashlib.sha256(source.read()).hexdigest()
        libraries = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in sorted({entry.resolve() for entry in Path("/opt/xml/lib").glob("*.so*")})}
        version = lambda value: ".".join(map(str, value[:3]))
        print(json.dumps(dict(python=sys.version.split()[0], pypdf=pypdf.__version__,
                              lxml=version(etree.LXML_VERSION), libxml=version(etree.LIBXML_VERSION),
                              libxmlCompiled=version(etree.LIBXML_COMPILED_VERSION),
                              libxslt=version(etree.LIBXSLT_VERSION), libxsltCompiled=version(etree.LIBXSLT_COMPILED_VERSION),
                              features=sorted(etree.LIBXML_FEATURES), expatImportable=expat_importable,
                              expatLoaded=expat_loaded, unavailable=unavailable, xmpPolicy=xmp.DOCUMENT_EXTRACTOR_XMP_POLICY,
                              xmpSourceHash=xmp_hash, nativeLibraries=libraries, zlib=zlib.ZLIB_RUNTIME_VERSION)))
        return
    if kind == "isolation":
        checks = {}
        for label, action in {
            "network": lambda: socket.socket(socket.AF_INET, socket.SOCK_STREAM),
            "private-read": lambda: open("/host/.local/runtime-config.json", "rb"),
            "write": lambda: open("/tmp/escape", "wb"),
            "fork": os.fork,
        }.items():
            try:
                action()
                checks[label] = False
            except OSError:
                checks[label] = True
        checks["nonroot"] = os.getuid() == 65532
        checks["fds"] = resource.getrlimit(resource.RLIMIT_NOFILE) == (64, 64)
        checks["cpu"] = resource.getrlimit(resource.RLIMIT_CPU) == (10, 10)
        print(json.dumps(checks))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--probe":
        probe(sys.argv[2])
    else:
        try:
            data = sys.stdin.buffer.read(MAX + 1)
            if not data or len(data) > MAX:
                reject("resource")
            metadata, value = extract(data, sys.argv[1])
            frame(dict(status="ok", metadata=metadata), value)
        except Rejected as error:
            frame(dict(status="rejected", reason=str(error)))
        except (MemoryError, RecursionError):
            frame(dict(status="rejected", reason="resource"))
        except Exception:
            frame(dict(status="rejected", reason="corrupt"))
