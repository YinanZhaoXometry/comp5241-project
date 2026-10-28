"""Build-only downstream pypdf 6.21.2 feature removal, not a new XML parser.

Verify pristine upstream bytes before editing, preserve notices and constants,
and update installed RECORD integrity metadata. Any upstream drift fails build.
The product extracts PDF pages only; unsupported XMP must fail before get_data.
"""
import base64
import csv
import hashlib
from pathlib import Path
import sysconfig

site = Path(sysconfig.get_path("purelib"))
target = site / "pypdf/xmp.py"
original = target.read_bytes()
# 6.21.2 source assessed 2026-10-24: the only change vs 6.21.1 is a ValueError
# wrap around datetime construction in a date helper; the Expat/XMP structure
# this shim removes is byte-identical. Wheel sha256 1d44d1a3…, xmp.py sha256:
if hashlib.sha256(original).hexdigest() != "0fb1996e355223d8ad669d289f16eb7e0ad9cd3314e8005cdb4c03defd876fea":
    raise RuntimeError("Unassessed pypdf XMP source; do not apply this patch")
source = original.decode("utf-8")
for line in (
    "from xml.dom.expatbuilder import ExpatBuilderNS\n",
    "from xml.dom.xmlbuilder import Options\n",
    "from xml.parsers.expat import ExpatError, XMLParserType\n",
):
    source = source.replace(line, "")
start = source.index("class _XmpBuilder(")
end = source.index("class XmpInformation(", start)
source = source[:start] + 'DOCUMENT_EXTRACTOR_XMP_POLICY = "disabled-v1"\n\n\n' + source[end:]
start = source.index("    def __init__(self, stream: StreamObject) -> None:")
end = source.index("    @classmethod", start)
source = source[:start] + '''    def __init__(self, stream: StreamObject) -> None:
        # Deliberately disabled downstream. Never decode or parse metadata XML.
        raise PdfReadError("XMP interpretation disabled by document extractor policy")

''' + source[end:]
patched = source.encode("utf-8")
target.write_bytes(patched)
record = site / "pypdf-6.21.2.dist-info/RECORD"
with record.open(newline="", encoding="utf-8") as handle:
    rows = list(csv.reader(handle))
matches = [row for row in rows if row[0] == "pypdf/xmp.py"]
if len(matches) != 1:
    raise RuntimeError("Unexpected pypdf integrity record")
matches[0][1:] = ["sha256=" + base64.urlsafe_b64encode(hashlib.sha256(patched).digest()).rstrip(b"=").decode("ascii"), str(len(patched))]
with record.open("w", newline="", encoding="utf-8") as handle:
    csv.writer(handle).writerows(rows)
