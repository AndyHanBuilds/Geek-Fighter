#!/usr/bin/env python3
"""Bundle facepunch/ into an itch.io zip that makes no third-party requests.

Run from the repo root:
    python build/make_zip.py              full build -> build/out/face_punch.zip
    python build/make_zip.py --check      only list the outside URLs, no download
    python build/make_zip.py --out PATH   write the zip somewhere else
    python build/make_zip.py --selfcheck  unzip + serve on :8773, request every file

Only the standard library is used. The source folder is never modified.
"""
import argparse, hashlib, http.server, json, os, posixpath, re, shutil, sys
import tempfile, threading, time, urllib.parse, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'facepunch')
VENDOR = os.path.join(ROOT, 'build', 'vendor')
OUT_DIR = os.path.join(ROOT, 'build', 'out')
DEFAULT_ZIP = os.path.join(OUT_DIR, 'face_punch.zip')
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
TEXT_EXT = {'.js', '.mjs', '.html', '.htm', '.css', '.json'}
URL_RE = re.compile(r"https://[^\s\"'`)<>\\]+")
ROOTREL_RE = re.compile(r"""(["'])(/(?:npm|gh)/[^"'\s]+)\1""")
PKG_RE = re.compile(r'/npm/(@?[^/@]+(?:/[^/@]+)?)@([^/]+)$')
EXCLUDE_NAMES = re.compile(r'^(_t_.*|PLAN.*|NOTES?.*|TODO.*|.*\.(txt|md|log|map|bak|orig))$', re.I)
LIMIT_TOTAL, LIMIT_FILE, LIMIT_COUNT = 500 * 2**20, 200 * 2**20, 1000
problems = []


def log(*a):
    print(*a, flush=True)


def problem(msg):
    problems.append(msg)
    log('  !! ' + msg)


def http_get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
            with urllib.request.urlopen(req, timeout=60) as r:  # redirects are followed
                return r.read()
        except Exception as e:
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError('%s (%s)' % (url, last))


def read_text(path):
    with open(path, 'rb') as f:
        return f.read().decode('utf-8', 'replace')


def classify_urls(text):
    """Return (loadable, links, consts). Links sit in comments or <a href>."""
    loadable, links = [], []
    consts = dict(re.findall(r"const\s+(\w+)\s*=\s*['\"]([^'\"]*)['\"]", text))
    for line in text.splitlines():
        s = line.strip()
        comment = s.startswith(('//', '/*', '*', '<!--'))
        for m in URL_RE.finditer(line):
            u = m.group(0).rstrip('.,;:')
            if comment or re.search(r'<a\s[^>]*href=["\']$', line[:m.start()]):
                links.append(u)
            else:
                loadable.append(u)
    return loadable, links, consts


def resolve_template(u, consts):
    r = re.sub(r'\$\{(\w+)\}', lambda m: consts.get(m.group(1), m.group(0)), u)
    return None if '${' in r else r


def local_rel(url):
    """Where a downloaded url lives, relative to the vendor root (posix)."""
    p = urllib.parse.urlsplit(url)
    path = urllib.parse.unquote(p.path)
    if path.endswith('/'):
        path += 'index'
    if p.query:
        h = hashlib.sha1(p.query.encode()).hexdigest()[:8]
        base, ext = posixpath.splitext(path)
        if not ext and 'fonts.googleapis' in p.netloc:
            ext = '.css'
        path = '%s_%s%s' % (base, h, ext)
    if posixpath.basename(path) == '+esm':
        path += '.js'  # so any static server sends a JavaScript MIME type
    return (p.netloc + path).replace(':', '_')


def vpath(rel):
    return os.path.join(VENDOR, *rel.split('/'))


def fetch_to_vendor(url):
    rel = local_rel(url)
    dest = vpath(rel)
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        return rel, False
    data = http_get(url)
    if not data:
        raise RuntimeError('empty response: ' + url)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(data)
    return rel, True


def package_files(base_url):
    m = PKG_RE.search(urllib.parse.urlsplit(base_url).path)
    api = 'https://data.jsdelivr.com/v1/package/npm/%s@%s' % (m.group(1), m.group(2))
    data = json.loads(http_get(api).decode())
    files = []

    def walk(items, prefix):
        for it in items:
            if it['type'] == 'file':
                files.append(prefix + it['name'])
            else:
                walk(it.get('files', []), prefix + it['name'] + '/')
    walk(data.get('files', []), '')
    return files


class Bundler:
    def __init__(self):
        self.deps = {}      # vendor rel -> [(original string, dep url)]
        self.done = {}      # url -> vendor rel (file) or vendor base rel (package), None on failure
        self.pkg = {}       # package base url -> list of vendor rels
        self.src_map = {}   # source file -> [(original, resolved)]
        self.hosts = {}
        self.stray = {}

    def scan(self):
        log('[1] Scanning facepunch/ for https:// URLs')
        for d, _, fs in os.walk(SRC):
            for n in sorted(fs):
                if os.path.splitext(n)[1].lower() not in TEXT_EXT or EXCLUDE_NAMES.match(n):
                    continue
                p = os.path.join(d, n)
                loadable, links, consts = classify_urls(read_text(p))
                ent = []
                for u in dict.fromkeys(loadable):
                    r = resolve_template(u, consts)
                    if r is None:
                        problem('%s: cannot resolve template URL %s' % (os.path.relpath(p, ROOT), u))
                        continue
                    ent.append((u, r))
                    self.hosts.setdefault(urllib.parse.urlsplit(r).netloc, set()).add(r)
                if ent:
                    self.src_map[p] = ent
                for u in sorted(set(links)):
                    log('  (comment/link, not fetched) %s: %s' % (os.path.relpath(p, ROOT), u))
        for h in sorted(self.hosts):
            log('  host %s' % h)
            for u in sorted(self.hosts[h]):
                log('    ' + u)

    def fetch(self, url):
        if url in self.done:
            return self.done[url]
        sp = urllib.parse.urlsplit(url)
        if sp.netloc == 'cdn.jsdelivr.net' and PKG_RE.search(sp.path):
            return self.fetch_package(url)
        try:
            rel, new = fetch_to_vendor(url)
            log('  %s %s' % ('got   ' if new else 'cached', rel))
            self.done[url] = rel
            self.expand(url, rel)
            return rel
        except Exception as e:
            problem('DOWNLOAD FAILED: %s' % e)
            self.done[url] = None
            return None

    def fetch_package(self, url):
        """A package base url (no file). Bundle what the game loads at run time."""
        m = PKG_RE.search(urllib.parse.urlsplit(url).path)
        try:
            files = package_files(url)
        except Exception as e:
            problem('package listing failed for %s: %s' % (url, e))
            self.done[url] = None
            return None
        want = [f for f in files if f.startswith('wasm/') or f == 'vision_bundle.mjs'] \
            if 'tasks-vision' in m.group(1) else []
        if not want:
            problem('package base %s has no known file list to bundle (%d files exist); '
                    'give the game direct file URLs or add them by hand' % (url, len(files)))
            self.done[url] = None
            return None
        rels = []
        for f in want:
            try:
                rel, new = fetch_to_vendor(url + '/' + f)
                rels.append(rel)
                log('  %s %s' % ('got   ' if new else 'cached', rel))
            except Exception as e:
                problem('DOWNLOAD FAILED: %s' % e)
        self.pkg[url] = rels
        self.done[url] = local_rel(url)
        return self.done[url]

    def expand(self, url, rel):
        """Look inside a downloaded js/css file for things it loads, and fetch those."""
        ext = os.path.splitext(rel)[1].lower()
        if ext not in ('.js', '.mjs', '.css'):
            return
        text = read_text(vpath(rel))
        host = urllib.parse.urlsplit(url).netloc
        deps = []
        for m in ROOTREL_RE.finditer(text):
            deps.append((m.group(2), 'https://' + host + m.group(2)))
        for m in re.finditer(r"""(?:from|import)\s*\(?\s*["'](https://[^"']+)["']""", text):
            deps.append((m.group(1), m.group(1)))
        if ext == '.css':
            for m in re.finditer(r"url\(\s*['\"]?([^'\")\s]+)['\"]?\s*\)", text):
                u = m.group(1)
                if u.startswith('data:') or u.startswith('#'):
                    continue
                deps.append((m.group(1), urllib.parse.urljoin(url, u)))
        out = []
        for orig, dep in dict.fromkeys(deps):
            if self.fetch(dep):
                out.append((orig, dep))
        if out:
            self.deps[rel] = out
        stray = {u.rstrip('.,;:') for u in URL_RE.findall(text)} - {d for _, d in deps}
        if stray:
            self.stray[rel] = sorted(stray)

    def download_all(self):
        log('[2] Downloading into build/vendor (cache: existing files are skipped)')
        for ent in self.src_map.values():
            for _, res in ent:
                self.fetch(res)


def rel_from(file_rel, target_rel):
    r = posixpath.relpath(target_rel, posixpath.dirname(file_rel) or '.')
    return r if r.startswith('.') else './' + r


def stage_and_rewrite(b, stage):
    log('[3] Staging a copy and rewriting URLs there (source untouched)')
    shutil.copytree(SRC, stage, ignore=lambda d, names: [n for n in names if EXCLUDE_NAMES.match(n)])
    copied = set()

    def copy_vendor(v):
        if v in copied:
            return
        copied.add(v)
        src = vpath(v)
        dst = os.path.join(stage, 'vendor', *v.split('/'))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if v in b.deps:
            text = read_text(src)
            for orig, dep in sorted(b.deps[v], key=lambda x: -len(x[0])):
                dv = b.done.get(dep)
                if dv:
                    text = text.replace(orig, rel_from(v, dv))
                    for r in b.pkg.get(dep, []) or [dv]:
                        copy_vendor(r)
            with open(dst, 'w', encoding='utf-8', newline='') as f:
                f.write(text)
        else:
            shutil.copy2(src, dst)

    for p, ent in b.src_map.items():
        rel = os.path.relpath(p, SRC).replace(os.sep, '/')
        sp = os.path.join(stage, *rel.split('/'))
        if not os.path.isfile(sp):
            continue
        text = read_text(sp)
        for orig, res in sorted(ent, key=lambda x: -len(x[0])):
            v = b.done.get(res)
            if not v:
                continue
            text = text.replace(orig, rel_from(rel, 'vendor/' + v))
            for r in b.pkg.get(res, []) or [v]:
                copy_vendor(r)
            if '/' in rel and not rel.endswith(('.html', '.css')):
                log('  note: %s sits in a subfolder; fetch() paths resolve against the page' % rel)
        with open(sp, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
    # package urls were rewritten with vendor/ prefix on the base path; package files are copied above
    return copied


def final_report(stage):
    log('[5] Remaining https:// URLs in the staged files')
    found = 0
    for d, _, fs in os.walk(stage):
        for n in sorted(fs):
            if os.path.splitext(n)[1].lower() not in TEXT_EXT:
                continue
            p = os.path.join(d, n)
            rel = os.path.relpath(p, stage).replace(os.sep, '/')
            loadable, links, _ = classify_urls(read_text(p))
            for u in sorted(set(loadable)):
                found += 1
                tag = 'inside a bundled library, not rewritten, check' if rel.startswith('vendor/') \
                    else 'STILL LOADS FROM OUTSIDE'
                log('  %s: %s  [%s]' % (rel, u, tag))
            if links and rel.startswith('vendor/'):
                log('  %s: %d text links in comments (harmless)' % (rel, len(set(links))))
            else:
                for u in sorted(set(links)):
                    log('  %s: %s  [harmless text link]' % (rel, u))
    if not found:
        log('  none in loadable positions')
    return found


def make_zip(stage, out):
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    if os.path.exists(out):
        os.remove(out)
    names, total, big = [], 0, []
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for d, _, fs in os.walk(stage):
            for n in sorted(fs):
                p = os.path.join(d, n)
                arc = os.path.relpath(p, stage).replace(os.sep, '/')
                z.write(p, arc)
                sz = os.path.getsize(p)
                total += sz
                names.append(arc)
                if sz > LIMIT_FILE:
                    big.append((arc, sz))
    log('[4] Zip written: %s' % out)
    log('  files: %d   unpacked: %.1f MB   zip: %.1f MB' %
        (len(names), total / 2**20, os.path.getsize(out) / 2**20))
    if 'index.html' not in names:
        problem('index.html is NOT at the top level of the zip')
    if total > LIMIT_TOTAL:
        log('  WARN: over 500 MB total (itch.io limit)')
    if len(names) > LIMIT_COUNT:
        log('  WARN: over 1000 files (itch.io limit)')
    for a, s in big:
        log('  WARN: %s is %.1f MB (over 200 MB)' % (a, s / 2**20))
    return names


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


REF_RE = re.compile(r"""(?:from\s*|import\s*\(?\s*|src=|href=|url\(\s*|"|')["']?(\.{1,2}/[^"'`)\s?#]+|[\w][\w./+@-]*\.(?:js|mjs|css|wasm|task|woff2?|mp3|png|jpg|svg|json))""")


def selfcheck(zip_path):
    log('[selfcheck] unzip, serve on 127.0.0.1:8773, request index.html and everything it references')
    d = tempfile.mkdtemp(prefix='fp_selfcheck_')
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(d)
    srv = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 8773), lambda *a, **k: Quiet(*a, directory=d, **k))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    bad, seen = 0, set()
    queue = ['index.html']
    for dp, _, fs in os.walk(d):
        for n in fs:
            queue.append(os.path.relpath(os.path.join(dp, n), d).replace(os.sep, '/'))
    mime = {'.js': 'javascript', '.mjs': 'javascript', '.wasm': 'wasm', '.css': 'css', '.html': 'html'}
    try:
        while queue:
            rel = queue.pop(0)
            if rel in seen:
                continue
            seen.add(rel)
            try:
                with urllib.request.urlopen('http://127.0.0.1:8773/' + urllib.parse.quote(rel)) as r:
                    body, ct = r.read(), r.headers.get('Content-Type', '')
            except Exception as e:
                bad += 1
                log('  MISSING %s (%s)' % (rel, e))
                continue
            ext = os.path.splitext(rel)[1].lower()
            if ext in mime and mime[ext] not in ct:
                bad += 1
                log('  BAD MIME %s: %s' % (rel, ct))
            if ext in ('.html', '.js', '.mjs', '.css'):
                for ref in REF_RE.findall(body.decode('utf-8', 'replace')):
                    if '${' in ref or ref.startswith('http'):
                        continue
                    if not ref.startswith('.') and ext != '.html':
                        continue
                    if not re.search(r'\.(js|mjs|css|wasm|task|woff2?|mp3|png|jpg|svg|json)$', ref):
                        continue
                    tgt = posixpath.normpath(posixpath.join(posixpath.dirname(rel), ref))
                    if tgt not in seen and not tgt.startswith('..'):
                        queue.append(tgt)
    finally:
        srv.shutdown()
        srv.server_close()
        shutil.rmtree(d, ignore_errors=True)
    log('  requested %d paths, problems: %d' % (len(seen), bad))
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='only report outside URLs')
    ap.add_argument('--out', default=DEFAULT_ZIP, help='zip path')
    ap.add_argument('--selfcheck', action='store_true', help='serve the built zip and request every file')
    a = ap.parse_args()
    t0 = time.time()
    if a.selfcheck:
        if not os.path.isfile(a.out):
            log('zip not found, run the build first: ' + a.out)
            return 2
        return 1 if selfcheck(a.out) else 0
    if not os.path.isdir(SRC):
        log('facepunch/ not found at ' + SRC)
        return 2
    b = Bundler()
    b.scan()
    if a.check:
        log('--check: nothing downloaded.')
        return 0
    b.download_all()
    stage_root = tempfile.mkdtemp(prefix='fp_stage_')
    stage = os.path.join(stage_root, 'game')
    try:
        stage_and_rewrite(b, stage)
        make_zip(stage, a.out)
        keep = os.path.join(OUT_DIR, 'staged')
        shutil.rmtree(keep, ignore_errors=True)
        shutil.copytree(stage, keep)
        left = final_report(stage)
    finally:
        shutil.rmtree(stage_root, ignore_errors=True)
    log('[done] %.0f s. Problems: %d. Outside URLs left in loadable spots: %d' % (time.time() - t0, len(problems), left))
    for p in problems:
        log('  PROBLEM: ' + p)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
