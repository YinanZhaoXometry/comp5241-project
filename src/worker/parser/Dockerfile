# Official Python 3.14.8 / Alpine 3.24, linux/arm64 manifest (not a mutable tag).
# Do not use lxml's wheel: it bundles older native libraries. Build against
# hash-verified upstream sources; no build tools/downloads in the runtime stage.
FROM python@sha256:aae362254cea6b75fe812f0b428f10b3b361a090fe5655fb1d03937f6d38cda9 AS xml-build
RUN apk add --no-cache build-base=0.5-r4 gcc=15.2.0-r5 g++=15.2.0-r5 make=4.4.1-r4 musl=1.2.6-r3 musl-dev=1.2.6-r3 binutils=2.45.1-r1 curl=8.22.0-r0 xz=5.8.4-r0 pkgconf=2.5.1-r0
WORKDIR /build
RUN curl --fail --location --proto '=https' -o xml.tar.xz https://download.gnome.org/sources/libxml2/2.15/libxml2-2.15.4.tar.xz \
    && echo '98087fd181d9070724f3fbc65c7377db03038eb92bd882374daff44940138821  xml.tar.xz' | sha256sum -c - \
    && tar -xf xml.tar.xz \
    && cd libxml2-2.15.4 \
    && ./configure --prefix=/opt/xml --without-python --without-catalog --without-http --without-zlib --without-iconv --without-icu \
    && make -j2 && make install \
    && mkdir -p /licenses && cp Copyright /licenses/libxml2-Copyright
ENV PKG_CONFIG_PATH=/opt/xml/lib/pkgconfig LD_LIBRARY_PATH=/opt/xml/lib
RUN curl --fail --location --proto '=https' -o xslt.tar.xz https://download.gnome.org/sources/libxslt/1.1/libxslt-1.1.45.tar.xz \
    && echo '9acfe68419c4d06a45c550321b3212762d92f41465062ca4ea19e632ee5d216e  xslt.tar.xz' | sha256sum -c - \
    && tar -xf xslt.tar.xz \
    && cd libxslt-1.1.45 \
    && ./configure --prefix=/opt/xml --without-python --without-crypto --without-plugins \
    && make -j2 && make install \
    && cp Copyright /licenses/libxslt-Copyright
RUN apk add --no-cache zlib-dev=1.3.2-r1 \
    && python -m pip install --no-cache-dir --no-deps 'https://files.pythonhosted.org/packages/ef/55/6dc6d6bb953bdfc52519a0059592c52b6e3b8ad51cf8256dffceb55b0610/setuptools-84.2.1-py3-none-any.whl#sha256=ca140b45d5325a9478f880e351484f62fef15f336462e449ca0c03c873d589c2' \
    && curl --fail --location --proto '=https' -o lxml.tar.gz https://files.pythonhosted.org/packages/23/ad/28ecd7cb894d172f3c9c80a075eeeb2017ac62e3632cee05a5f9493547eb/lxml-6.1.3.tar.gz \
    && echo '45222d94ddd511536f3b2f7d9deae3b2339b4ce0f075f1ca25703b07cad9dd21  lxml.tar.gz' | sha256sum -c - \
    && tar -xf lxml.tar.gz \
    && WITHOUT_CYTHON=true WITHOUT_ZLIB=true CFLAGS='-O2' LDFLAGS='-Wl,-rpath,/opt/xml/lib' python -m pip wheel --no-cache-dir --no-deps --no-build-isolation --wheel-dir /wheels ./lxml-6.1.3 \
    && apk info -v > /licenses/build-apk.txt \
    && sha256sum xml.tar.xz xslt.tar.xz lxml.tar.gz /wheels/*.whl > /licenses/build-sha256.txt

FROM python@sha256:aae362254cea6b75fe812f0b428f10b3b361a090fe5655fb1d03937f6d38cda9
COPY --from=xml-build /opt/xml/lib/*.so* /opt/xml/lib/
COPY --from=xml-build /licenses /usr/share/licenses/document-parser
COPY --from=xml-build /wheels /build/wheels
COPY requirements.txt /build/requirements.txt
COPY disable_xmp.py /build/disable_xmp.py
# CVE-2026-107891 (no public details at admission time): the pinned Alpine base
# ships musl 1.2.6-r2; Alpine's fixed 1.2.6-r3 is pinned in every stage so the
# scanner-clean requirement holds without changing any other component.
RUN apk add --no-cache zlib=1.3.2-r1 musl=1.2.6-r3 musl-utils=1.2.6-r3 \
    && python -m pip install --no-cache-dir --no-deps --require-hashes -r /build/requirements.txt \
    && python -m pip install --no-cache-dir --no-deps --no-index /build/wheels/*.whl \
    && python -I -B /build/disable_xmp.py \
    && rm -f /usr/local/lib/python3.14/lib-dynload/pyexpat*.so /usr/local/lib/python3.14/lib-dynload/_elementtree*.so \
    && rm -rf /build /root/.cache /usr/local/lib/python3.14/site-packages/pip* /usr/local/bin/pip* /usr/local/lib/python3.14/ensurepip \
    && find /usr/local/lib/python3.14 -type d -name __pycache__ -exec rm -rf {} +
COPY parser.py /parser.py
USER 65532:65532
ENV HOME=/nonexistent PYTHONDONTWRITEBYTECODE=1 LD_LIBRARY_PATH=/opt/xml/lib
ENTRYPOINT ["/usr/local/bin/python", "-I", "-B", "/parser.py"]
