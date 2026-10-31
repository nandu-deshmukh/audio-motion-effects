#!/usr/bin/env python3
"""
Motion Editor v5 - dynamic (Kdenlive jaisa), sirf standard library + ffmpeg/ffprobe.

Run:   python3 motion_editor.py                       -> http://localhost:8000
       python3 motion_editor.py 9000                  -> custom port
       python3 motion_editor.py my_project.json       -> kisi aur project file se

Folder me rakho:  motions.js  (common effects file - pehle wali hi chalegi, nahi ho to ban jayegi)
                  (config_settings.py ki ab zarurat nahi; audio = jo file audio track par dalo)

Project file: editor_motion.json  (Save As se kisi bhi naam se save ho sakti hai)
  settings  : width/height/fps/fade/image_len/root_folder
  audio     : path/name/duration   (isi se video ki total length)
  media     : library (import ki hui image/video files)
  clips     : timeline (start, duration, in/out, effects ...)  -> animate_data.py jaisa hi format

Audio animation: audio_look/*.js (ek class = ek file) + audio_animations.js (common kit). Right panel ka "🎧 Audio animations" tab. Analysis audio (raw voice) chuno -> audio_data.npz khud banti hai
         (numpy chahiye). Animation ko clip ya stage par girao; position drag se badalti hai. audio_animations.js = registry.
Render:  1) Full video  -> final/<project>.mp4  (audio ke saath)
         2) Selected image ka animation -> motion/<start_end>.mp4
"""
import os, re, sys, json, wave, uuid, time, shutil, pprint, hashlib, mimetypes, threading, subprocess, importlib.util
from array import array
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
PORT, PROJECT_ARG = 8000, "editor_motion.json"
for _a in sys.argv[1:]:
    if _a.isdigit():
        PORT = int(_a)
    elif _a.lower().endswith(".json"):
        PROJECT_ARG = _a
CUR = [PROJECT_ARG if os.path.isabs(PROJECT_ARG) else os.path.join(HERE, PROJECT_ARG)]   # abhi khula project
CONFIG_PY = os.path.join(HERE, "config_settings.py")
MOTIONS_JS = os.path.join(HERE, "motions.js")
EXPORT_PY = os.path.join(HERE, "animate_data_new.py")
PROXY_DIR = os.path.join(HERE, ".proxy_cache")
THUMB_DIR = os.path.join(HERE, ".thumbs")
CACHE_DIR = os.path.join(HERE, ".cache")
RENDER_DIR = os.path.join(HERE, "motion")
FINAL_DIR = os.path.join(HERE, "final")

for ext, mt in ((".mp4", "video/mp4"), (".mkv", "video/x-matroska"), (".mov", "video/quicktime"), (".wav", "audio/wav")):
    mimetypes.add_type(mt, ext)

IMG = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
VID = {".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v"}
AUD = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"}


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ROOT = os.path.expanduser("~")      # file browser yahin se shuru hota hai (Settings me badal sakte ho)
if not os.path.isdir(ROOT):
    ROOT = HERE


def kind(path):
    e = os.path.splitext(path)[1].lower()
    return "image" if e in IMG else "video" if e in VID else "audio" if e in AUD else ""


def natkey(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def safe_name(s):
    return re.sub(r"[^\w.\- ]", "_", str(s)).strip() or "x"


def has(cmd):
    return shutil.which(cmd) is not None


# ---------------- project ----------------
def default_project(name="project"):
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    p = {"editor": "motion_editor", "version": 1, "name": name, "created": now, "modified": now,
         "settings": {"width": 1280, "height": 720, "fps": 25, "fade": 0.35, "image_len": 5.0, "root_folder": ROOT},
         "audio": {"path": "", "name": "", "duration": 0}, "vis_audio": {"path": "", "name": "", "duration": 0},
         "media": [], "clips": [], "atracks": [], "aclips": [], "vtrack": {"mute": False, "vol": 0}}
    return p


def fix_project(p):
    d = default_project(p.get("name", "project"))
    for k, v in d.items():
        p.setdefault(k, v)
    for k, v in d["settings"].items():
        p["settings"].setdefault(k, v)
    return p


def load_project(path):
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            return fix_project(json.load(f))
    p = default_project(os.path.splitext(os.path.basename(path))[0])
    save_project(path, p)
    return p


def save_project(path, p):
    p["modified"] = time.strftime("%Y-%m-%d %H:%M:%S")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(p, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def list_projects():
    out = []
    for f in sorted(os.listdir(HERE)):
        fp = os.path.join(HERE, f)
        if not f.lower().endswith(".json") or not os.path.isfile(fp) or os.path.getsize(fp) > 30_000_000:
            continue
        try:
            with open(fp, encoding="utf-8") as fh:
                j = json.load(fh)
        except Exception:
            continue
        if isinstance(j, dict) and j.get("editor") == "motion_editor":
            out.append({"file": f, "name": j.get("name", f), "modified": j.get("modified", ""), "clips": len(j.get("clips", []))})
    return out


# ---------------- path resolve ----------------
_name_cache = None


def name_index():
    global _name_cache
    if _name_cache is None:
        _name_cache = {}
        for dp, _, fs in os.walk(HERE):
            for f in fs:
                _name_cache.setdefault(f, os.path.join(dp, f))
    return _name_cache


def resolve_path(res):
    if not res:
        return None
    for c in ([res] if os.path.isabs(res) else [os.path.join(ROOT, res), os.path.join(HERE, res)]):
        if os.path.isfile(c):
            return c
    return name_index().get(os.path.basename(res))


# ---------------- old animate_data -> project ----------------
def convert_old(items, name):
    p = default_project(name)
    seen = set()
    for d in items:
        res = resolve_path(d.get("resource", "")) or d.get("resource", "")
        c = dict(d)
        c["id"] = "c" + uuid.uuid4().hex[:6]
        c["resource"] = res
        c["name"] = os.path.basename(res)
        if c.get("type") == "image":
            fx = c.get("effects")
            if not isinstance(fx, list):
                fx = [{"key": c["motion"], "start": 0.0, "dur": c.get("duration", 0)}] if c.get("motion") else []
            c["effects"] = fx
        if res not in seen:
            seen.add(res)
            p["media"].append({"path": res, "type": c.get("type", kind(res)), "name": os.path.basename(res),
                               "duration": c.get("duration", 0) if c.get("type") == "video" else 0})
        p["clips"].append(c)
    return p


# ---------------- probe / thumbs / peaks ----------------
def probe(path):
    info = {"ok": False, "duration": 0, "width": 0, "height": 0}
    if not path or not os.path.isfile(path):
        return info
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", path],
                           capture_output=True, timeout=40)
        j = json.loads(r.stdout or b"{}")
        info["duration"] = float((j.get("format") or {}).get("duration") or 0)
        st = (j.get("streams") or [{}])[0]
        info["width"], info["height"] = st.get("width", 0), st.get("height", 0)
    except Exception:
        pass
    if not info["duration"] and path.lower().endswith(".wav"):
        try:
            with wave.open(path, "rb") as w:
                info["duration"] = w.getnframes() / float(w.getframerate())
        except Exception:
            pass
    info["ok"] = info["duration"] > 0 or kind(path) == "image"
    return info


_thumb_sem = threading.Semaphore(3)


def make_thumb(path, t=0.0, w=240):
    if not path or not os.path.isfile(path) or not has("ffmpeg"):
        return None
    os.makedirs(THUMB_DIR, exist_ok=True)
    key = hashlib.md5(f"{path}|{int(os.path.getmtime(path))}|{round(t, 1)}|{w}".encode()).hexdigest()[:18]
    out = os.path.join(THUMB_DIR, key + ".jpg")
    if os.path.isfile(out):
        return out
    with _thumb_sem:
        for tt in ([t, 0.0] if kind(path) == "video" else [0.0]):
            tmp = out + ".tmp.jpg"
            cmd = ["ffmpeg", "-y", "-loglevel", "error"] + (["-ss", str(tt)] if kind(path) == "video" else []) + \
                  ["-i", path, "-frames:v", "1", "-vf", f"scale={w}:-2", "-q:v", "4", tmp]
            try:
                subprocess.run(cmd, capture_output=True, timeout=40)
            except Exception:
                return None
            if os.path.isfile(tmp) and os.path.getsize(tmp) > 0:
                os.replace(tmp, out)
                return out
    return None


_peaks = {}


def _peaks_wave(path, pps):
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2:
            return None
        per, out = max(1, w.getframerate() // pps), []
        while True:
            data = w.readframes(per)
            if not data:
                break
            a = array("h")
            a.frombytes(data[: len(data) // 2 * 2])
            if sys.byteorder == "big":
                a.byteswap()
            out.append(round(max(max(a), -min(a)) / 32768, 3) if len(a) else 0)
        return out


def _peaks_ffmpeg(path, pps):
    per = 8000 // pps
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    out = []
    while True:
        data = p.stdout.read(per * 2)
        if not data:
            break
        a = array("h")
        a.frombytes(data[: len(data) // 2 * 2])
        if sys.byteorder == "big":
            a.byteswap()
        out.append(round(max(max(a), -min(a)) / 32768, 3) if len(a) else 0)
    p.wait()
    return out


def _peaks_worker(path, st, cache):
    pps = 10
    try:
        d = probe(path).get("duration", 0)
        pps = 100 if 0 < d <= 30 else 40 if 0 < d <= 120 else 10      # chhoti SFX files ka waveform barik
        pk = None
        try:
            pk = _peaks_wave(path, pps)
        except Exception:
            pk = None
        if pk is None and has("ffmpeg"):
            pk = _peaks_ffmpeg(path, pps)
        if pk is None:
            st.update(state="error", pps=pps, peaks=[])
            return
        st.update(state="ready", pps=pps, peaks=pk)
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(cache, "w") as f:
            json.dump({"pps": pps, "peaks": pk}, f)
    except Exception:
        st.update(state="error", pps=pps, peaks=[])


def peaks_get(path):
    if not path or not os.path.isfile(path):
        return {"state": "error", "peaks": [], "pps": 10}
    mt = int(os.path.getmtime(path))
    st = _peaks.get(path)
    if st and st.get("mt") == mt:
        return st
    cache = os.path.join(CACHE_DIR, "peaks_" + hashlib.md5(f"{path}|{mt}".encode()).hexdigest()[:14] + ".json")
    if os.path.isfile(cache):
        try:
            with open(cache) as f:
                j = json.load(f)
            st = {"state": "ready", "mt": mt, "pps": j["pps"], "peaks": j["peaks"]}
            _peaks[path] = st
            return st
        except Exception:
            pass
    st = {"state": "working", "mt": mt, "pps": 10, "peaks": []}
    _peaks[path] = st
    threading.Thread(target=_peaks_worker, args=(path, st, cache), daemon=True).start()
    return st


# ---------------- H.264 proxy (browser codec fallback) ----------------
_proxy_lock = threading.Lock()


def make_proxy(src):
    if not src or not os.path.isfile(src):
        return None
    os.makedirs(PROXY_DIR, exist_ok=True)
    out = os.path.join(PROXY_DIR, f"{hashlib.md5(src.encode()).hexdigest()[:10]}_{int(os.path.getmtime(src))}.mp4")
    if os.path.isfile(out):
        return out
    with _proxy_lock:
        if os.path.isfile(out):
            return out
        tmp = out + ".tmp.mp4"
        cmd = ["ffmpeg", "-y", "-i", src, "-vf", "scale=-2:540", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
               "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", tmp]
        try:
            r = subprocess.run(cmd, capture_output=True)
        except FileNotFoundError:
            return None
        if r.returncode != 0 or not os.path.isfile(tmp):
            return None
        os.replace(tmp, out)
    return out


# ---------------- folder browser ----------------
def list_dir(path, mode):
    path = os.path.abspath(path or ROOT)
    if os.path.isfile(path):
        path = os.path.dirname(path)
    if not os.path.isdir(path):
        path = ROOT
    exts = AUD if mode == "audio" else (IMG | VID | AUD)
    dirs, files = [], []
    try:
        for n in sorted(os.listdir(path), key=natkey):
            if n.startswith("."):
                continue
            full = os.path.join(path, n)
            if os.path.isdir(full):
                dirs.append({"name": n, "path": full})
            elif os.path.splitext(n)[1].lower() in exts:
                files.append({"name": n, "path": full, "type": kind(n), "size": os.path.getsize(full)})
    except OSError:
        pass
    parent = os.path.dirname(path)
    return {"path": path, "parent": parent if parent != path else "", "dirs": dirs, "files": files}


def scan_dir(path, recursive):
    out = []
    if recursive:
        for dp, dn, fs in os.walk(path):
            dn[:] = sorted([d for d in dn if not d.startswith(".")], key=natkey)
            for f in sorted(fs, key=natkey):
                if kind(f) in ("image", "video", "audio"):
                    out.append(os.path.join(dp, f))
    else:
        for f in sorted(os.listdir(path), key=natkey):
            if kind(f) in ("image", "video", "audio") and os.path.isfile(os.path.join(path, f)):
                out.append(os.path.join(path, f))
    return [{"path": p, "name": os.path.basename(p), "type": kind(p)} for p in out]


# ---------------- selected image animation render: motion/<name>.mp4 ----------------
_jobs, _job_n = {}, [0]


def _tail(path, n=500):
    try:
        with open(path, "rb") as f:
            return f.read()[-n:].decode(errors="ignore")
    except OSError:
        return ""


def render_start(rel, fps):
    parts = [safe_name(x) for x in re.split(r"[\\/]+", rel) if x not in ("", ".", "..")]
    out = os.path.join(RENDER_DIR, *parts)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    log = out + ".log"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-",
           "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", out]
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=open(log, "wb"))
    except FileNotFoundError:
        return None, "ffmpeg install nahi hai / PATH me nahi mila"
    _job_n[0] += 1
    jid = str(_job_n[0])
    _jobs[jid] = (proc, out, log)
    return jid, out


def render_frame(jid, raw):
    job = _jobs.get(jid)
    if not job:
        return False, "job nahi mila"
    try:
        job[0].stdin.write(raw)
        return True, ""
    except (BrokenPipeError, OSError):
        return False, "ffmpeg ruk gaya: " + _tail(job[2])


def render_end(jid):
    job = _jobs.pop(jid, None)
    if not job:
        return False, "job nahi mila"
    proc, out, log = job
    try:
        proc.stdin.close()
    except OSError:
        pass
    rc = proc.wait()
    if rc != 0 or not os.path.isfile(out):
        return False, "ffmpeg error: " + _tail(log)
    try:
        os.remove(log)
    except OSError:
        pass
    return True, out


def render_cancel(jid):
    job = _jobs.pop(jid, None)
    if job:
        job[0].kill()
        try:
            os.remove(job[1])
        except OSError:
            pass


# ---------------- full video render ----------------
FINAL = {"state": "idle", "pct": 0, "msg": "", "file": "", "cancel": False}


def run_ff(cmd):
    r = subprocess.run(cmd, capture_output=True)
    return r.returncode == 0 and os.path.isfile(cmd[-1]), r.stderr.decode(errors="ignore")[-400:]


def _db(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _has_audio(path):
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
                           capture_output=True, timeout=40)
        return bool(r.stdout.strip())
    except Exception:
        return False


def _audio_items(proj, clips):
    """video clips ki awaaz + SFX clips  ->  list of {file, ss, t, db, fi, fo, at}"""
    items = []
    vt = proj.get("vtrack") or {}
    atr = {t.get("id"): t for t in proj.get("atracks", [])}
    if not vt.get("mute"):
        for c in clips:
            if c.get("type") != "video" or c.get("amute"):
                continue
            src = resolve_path(c.get("resource", ""))
            if src and _has_audio(src):
                items.append({"file": src, "ss": float(c.get("in", 0) or 0), "t": float(c["duration"]),
                              "db": _db(c.get("vol_db")) + _db(vt.get("vol")), "fi": 0.0, "fo": 0.0, "at": float(c["start"])})
    for a in proj.get("aclips", []):
        tr = atr.get(a.get("track"), {})
        if a.get("mute") or tr.get("mute"):
            continue
        src = resolve_path(a.get("resource", ""))
        if src:
            items.append({"file": src, "ss": float(a.get("in", 0) or 0), "t": float(a["duration"]),
                          "db": _db(a.get("vol")) + _db(tr.get("vol")), "fi": float(a.get("fi") or 0),
                          "fo": float(a.get("fo") or 0), "at": float(a["start"])})
    return items


def _final_mux(proj, clips, lst, audio, outp, tmp):
    """concat video + main audio + video ki awaaz + SFX  ->  final mp4 (dB, fade, delay, mute ke saath)"""
    au = proj.get("audio") or {}
    items = _audio_items(proj, clips)
    use_main = bool(audio) and not au.get("mute")
    base_cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst]
    if not use_main and not items:
        return run_ff(base_cmd + ["-c", "copy", "-movflags", "+faststart", outp])

    def build(norm):
        cmd, parts, labels, idx = list(base_cmd), [], [], 1
        if use_main:
            cmd += ["-i", audio]
            parts.append(f"[{idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume={_db(au.get('vol')):.2f}dB[a{idx}]")
            labels.append(f"[a{idx}]")
            idx += 1
        for it in items:
            cmd += ["-ss", f"{it['ss']:.3f}", "-t", f"{it['t']:.3f}", "-i", it["file"]]
            f = f"[{idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume={it['db']:.2f}dB"
            if it["fi"] > 0:
                f += f",afade=t=in:st=0:d={it['fi']:.3f}"
            if it["fo"] > 0:
                f += f",afade=t=out:st={max(0.0, it['t'] - it['fo']):.3f}:d={it['fo']:.3f}"
            ms = int(round(it["at"] * 1000))
            if ms > 0:
                f += f",adelay={ms}|{ms}"
            parts.append(f + f"[a{idx}]")
            labels.append(f"[a{idx}]")
            idx += 1
        n = len(labels)
        if n == 1:
            out_label = labels[0]
        else:
            mix = "".join(labels) + f"amix=inputs={n}:duration=longest" + (":normalize=0" if norm else f",volume={n}")
            parts.append(mix + "[aout]")
            out_label = "[aout]"
        fc = ";".join(parts)
        if len(fc) > 100000:
            sp = os.path.join(tmp, "af.txt")
            with open(sp, "w", encoding="utf-8") as f:
                f.write(fc)
            fargs = ["-filter_complex_script", sp]
        else:
            fargs = ["-filter_complex", fc]
        return cmd + fargs + ["-map", "0:v", "-map", out_label, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                              "-movflags", "+faststart", outp]

    ok, err = run_ff(build(True))
    if not ok and "normalize" in err.lower():       # purani ffmpeg: amix normalize option nahi
        ok, err = run_ff(build(False))
    return ok, err


# ---------------- selected video clip render: motion/<output>.mp4 ----------------
CJOB = {"state": "idle", "msg": "", "file": ""}


def render_clip_worker(proj, cid, vpart_rel):
    try:
        st = proj.get("settings", {})
        W, H, FPS = int(st.get("width", 1280)), int(st.get("height", 720)), int(st.get("fps", 25))
        c = next((x for x in proj.get("clips", []) if x.get("id") == cid), None)
        if not c or c.get("type") != "video":
            raise RuntimeError("video clip nahi mila")
        src = resolve_path(c.get("resource", ""))
        if not src:
            raise RuntimeError("video file nahi mili: " + str(c.get("resource")))
        dur = float(c["duration"])
        n = max(1, int(round(dur * FPS)))
        os.makedirs(RENDER_DIR, exist_ok=True)
        outp = os.path.join(RENDER_DIR, safe_name(c.get("output") or "clip") + ".mp4")
        vt = proj.get("vtrack") or {}
        VF = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS},tpad=stop_mode=clone:stop_duration=36000"
        vp = os.path.join(HERE, vpart_rel) if vpart_rel else None
        vp = vp if vp and os.path.isfile(vp) else None
        base = outp + ".base.mp4" if vp else outp
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(c.get("in", 0) or 0), "-t", f"{dur:.3f}", "-i", src,
               "-vf", VF, "-frames:v", str(n), "-map", "0:v:0"]
        if _has_audio(src) and not c.get("amute") and not vt.get("mute"):
            cmd += ["-map", "0:a:0", "-af", f"volume={_db(c.get('vol_db')) + _db(vt.get('vol')):.2f}dB", "-c:a", "aac", "-b:a", "192k"]
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), base]
        ok, err = run_ff(cmd)
        if not ok:
            raise RuntimeError("ffmpeg error: " + err)
        if vp:
            bcmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", base, "-i", vp, "-filter_complex",
                    f"[0:v]format=gbrp[a];[1:v]scale={W}:{H},fps={FPS},format=gbrp[b];[a][b]blend=all_mode=addition,format=yuv420p[v]",
                    "-map", "[v]", "-map", "0:a?", "-frames:v", str(n), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                    "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "copy", outp]
            ok, err = run_ff(bcmd)
            try:
                os.remove(base)
            except OSError:
                pass
            if not ok:
                raise RuntimeError("audio animation blend error: " + err)
        CJOB.update(state="done", file=os.path.relpath(outp, HERE), msg="")
    except Exception as e:
        CJOB.update(state="error", msg=str(e))


def final_worker(proj, parts, vparts):
    F = FINAL
    try:
        st = proj.get("settings", {})
        W, H, FPS = int(st.get("width", 1280)), int(st.get("height", 720)), int(st.get("fps", 25))
        clips = sorted(proj.get("clips", []), key=lambda c: c.get("start", 0))
        au = proj.get("audio", {}) or {}
        audio = resolve_path(au.get("path", ""))
        adur = float(au.get("duration") or 0)
        if audio and not adur:
            adur = probe(audio).get("duration", 0)
        end = max([c["start"] + c["duration"] for c in clips] + [a["start"] + a["duration"] for a in proj.get("aclips", [])] or [0])
        total_f = int(round(max(adur, end) * FPS))
        if total_f <= 0:
            raise RuntimeError("timeline khali hai")
        tmp = os.path.join(HERE, ".render_tmp")
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        VF = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1"
        ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), "-an"]
        pieces, cur = [], 0
        for c in clips:
            sf, ef = int(round(c["start"] * FPS)), int(round((c["start"] + c["duration"]) * FPS))
            if sf > cur:
                pieces.append((None, sf - cur))
                cur = sf
            if ef - cur > 0:
                pieces.append((c, ef - cur))
                cur = ef
        if total_f > cur:
            pieces.append((None, total_f - cur))
        files, notes = [], []
        for i, (c, n) in enumerate(pieces):
            if F["cancel"]:
                F.update(state="cancelled", msg="cancel")
                return
            out = os.path.join(tmp, "p%05d.mp4" % i)
            F["msg"] = f"piece {i + 1}/{len(pieces)}"
            black = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:r={FPS}", "-frames:v", str(n), *ENC, out]
            cmd = black
            if c is not None:
                src = resolve_path(c.get("resource", ""))
                part = parts.get(c.get("id", "")) if c.get("type") == "image" else None
                part = os.path.join(HERE, part) if part else None
                pad = f"fps={FPS},tpad=stop_mode=clone:stop_duration=36000"
                if not src:
                    notes.append("file nahi mili: " + str(c.get("resource")))
                elif c.get("type") == "video":
                    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(c.get("in", 0)), "-i", src, "-vf", f"{VF},{pad}",
                           "-frames:v", str(n), *ENC, out]
                elif part and os.path.isfile(part):
                    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", part, "-vf", f"{VF},{pad}", "-frames:v", str(n), *ENC, out]
                else:
                    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", str(FPS), "-i", src,
                           "-vf", f"{VF},format=yuv420p", "-frames:v", str(n), *ENC, out]
            vpart = None
            if c is not None and vparts.get(c.get("id", "")):
                vp = os.path.join(HERE, vparts[c["id"]])
                vpart = vp if os.path.isfile(vp) else None
            if vpart:
                base = out + ".base.mp4"
                cmd[-1] = base
            ok, err = run_ff(cmd)
            if not ok:
                raise RuntimeError("ffmpeg piece error: " + err)
            if vpart:      # audio animation overlay: additive blend (cv2.add jaisa) video / image piece ke upar
                bcmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", base, "-i", vpart, "-filter_complex",
                        f"[0:v]format=gbrp[a];[1:v]scale={W}:{H},fps={FPS},format=gbrp[b];[a][b]blend=all_mode=addition,format=yuv420p",
                        "-frames:v", str(n), *ENC, out]
                ok, err = run_ff(bcmd)
                try:
                    os.remove(base)
                except OSError:
                    pass
                if not ok:
                    raise RuntimeError("audio animation blend error: " + err)
            files.append(out)
            F["pct"] = int((i + 1) / len(pieces) * 95)
        lst = os.path.join(tmp, "list.txt")
        with open(lst, "w", encoding="utf-8") as f:
            for p in files:
                f.write("file '" + p.replace("'", "'\\''") + "'\n")
        os.makedirs(FINAL_DIR, exist_ok=True)
        outp = os.path.join(FINAL_DIR, safe_name(proj.get("name") or "project") + ".mp4")
        F["msg"] = "audio mix ho rahi hai (main + video ki awaaz + SFX)..."
        ok, err = _final_mux(proj, clips, lst, audio, outp, tmp)
        if not ok:
            raise RuntimeError("final ffmpeg error: " + err)
        shutil.rmtree(tmp, ignore_errors=True)
        F.update(state="done", pct=100, file=os.path.relpath(outp, HERE), msg="; ".join(notes))
    except Exception as e:
        F.update(state="error", msg=str(e))


# ---------------- audio visualization data (audio_data.npz) ----------------
# Analysis audio (raw voice) chunon me padhi jati hai (1 ghante ki file bhi RAM nahi khati) aur
# peaks / rms / zcr / lows / mids / highs / spectralCentroid nikalke audio_data.npz me save hote hain.
# npz me audioPath + audioMtime bhi rehta hai. Purani audio_data.py (bridge) jaisi thi waisi hi chalegi.
VIS_BLOCK = 2048
NPZ_PATH = os.path.join(HERE, "audio_data.npz")
VIS = {"state": "idle", "pct": 0, "msg": "", "path": ""}
_visd = {}


def has_numpy():
    try:
        import numpy  # noqa: F401
        return True
    except ImportError:
        return False


def _vis_chunks(np, path, block):
    per = block * 512
    try:
        wf = wave.open(path, "rb")
        if wf.getsampwidth() != 2:
            wf.close()
            raise wave.Error("not 16 bit")
        ch, sr, nf = wf.getnchannels(), wf.getframerate(), wf.getnframes()

        def gen():
            with wf:
                while True:
                    raw = wf.readframes(per)
                    if not raw:
                        break
                    raw = raw[: len(raw) // (2 * ch) * (2 * ch)]
                    a = np.frombuffer(raw, dtype=np.int16)
                    if ch > 1:
                        a = a.reshape(-1, ch).mean(axis=1)
                    yield a.astype(np.float32)
        return sr, nf, gen()
    except (wave.Error, EOFError):
        pass
    if not has("ffmpeg"):
        raise RuntimeError("WAV 16-bit nahi hai aur ffmpeg bhi nahi mila")
    sr = 44100
    est = int(probe(path).get("duration", 0) * sr)
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def gen2():
        while True:
            raw = proc.stdout.read(per * 2)
            if not raw:
                break
            raw = raw[: len(raw) // 2 * 2]
            yield np.frombuffer(raw, dtype=np.int16).astype(np.float32)
        proc.wait()
    return sr, est, gen2()


def _install_npz(src):
    try:
        import numpy as np
        if os.path.isfile(NPZ_PATH):
            with np.load(NPZ_PATH) as z:
                mine = "audioPath" in z.files
            bk = os.path.join(HERE, "audio_data_backup.npz")
            if not mine and not os.path.isfile(bk):
                shutil.copyfile(NPZ_PATH, bk)          # tumhari purani npz ka backup
    except Exception:
        pass
    shutil.copyfile(src, NPZ_PATH)


def _vis_analyze(path, mt, cache):
    import numpy as np
    block = VIS_BLOCK
    sr, nf, chunks = _vis_chunks(np, path, block)
    acc = {k: [] for k in ("peaks", "rms", "zcr", "lows", "mids", "highs", "centroid")}
    freqs = np.fft.rfftfreq(block, 1.0 / sr)
    lo, mi, hi = freqs < 250, (freqs >= 250) & (freqs < 4000), freqs >= 4000
    carry, done = np.zeros(0, dtype=np.float32), 0
    for a in chunks:
        if len(carry):
            a = np.concatenate([carry, a])
        use = len(a) // block * block
        carry = a[use:]
        if not use:
            continue
        blk = a[:use].reshape(-1, block) / 32768.0
        sp = np.abs(np.fft.rfft(blk, axis=1))
        ss = np.sum(sp, axis=1)
        ss[ss == 0] = 1e-10
        acc["peaks"].append(np.round(np.max(np.abs(blk), axis=1), 4))
        acc["rms"].append(np.round(np.sqrt(np.mean(blk ** 2, axis=1)), 4))
        acc["zcr"].append(np.round(np.mean(np.abs(np.diff(np.signbit(blk), axis=1)), axis=1), 4))
        acc["lows"].append(np.round(np.sum(sp[:, lo], axis=1), 2))
        acc["mids"].append(np.round(np.sum(sp[:, mi], axis=1), 2))
        acc["highs"].append(np.round(np.sum(sp[:, hi], axis=1), 2))
        acc["centroid"].append(np.round(np.sum(freqs * sp, axis=1) / ss, 1))
        done += use
        VIS["pct"] = min(99, int(done / max(1, nf) * 100))
    if not acc["peaks"]:
        raise RuntimeError("audio khali hai ya padh nahi paye")
    d = {k: np.concatenate(v) for k, v in acc.items()}
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = cache + ".tmp.npz"
    np.savez_compressed(tmp, sampleRate=sr, blockSize=block, peaksPerSecond=sr / block, totalBlocks=len(d["peaks"]),
                        peaks=d["peaks"], rms=d["rms"], zcr=d["zcr"], lows=d["lows"], mids=d["mids"], highs=d["highs"],
                        spectralCentroid=d["centroid"], audioPath=np.array(path), audioMtime=np.array(mt))
    os.replace(tmp, cache)
    _install_npz(cache)


def _vis_worker(path, mt, cache):
    try:
        _vis_analyze(path, mt, cache)
        VIS.update(state="ready", pct=100, msg="")
    except Exception as e:
        VIS.update(state="error", msg=str(e))


def npz_info():
    try:
        import numpy as np
        with np.load(NPZ_PATH) as z:
            return {"path": str(z["audioPath"]), "audioMtime": int(z["audioMtime"])}
    except Exception:
        return None


def vis_ensure(path):
    if not path or not os.path.isfile(path):
        return False, "analysis audio file nahi mili"
    if not has_numpy():
        return False, "numpy install nahi hai: pip install numpy"
    if VIS["state"] == "working":
        return (True, "working") if VIS["path"] == path else (False, "pehle wala analysis abhi chal raha hai")
    mt = int(os.path.getmtime(path))
    info = npz_info()
    if info and info["path"] == path and info["audioMtime"] == mt:
        VIS.update(state="ready", pct=100, msg="", path=path)
        return True, "ready"
    cache = os.path.join(CACHE_DIR, "vis_" + hashlib.md5(f"{path}|{mt}|{VIS_BLOCK}".encode()).hexdigest()[:16] + ".npz")
    if os.path.isfile(cache):
        _install_npz(cache)
        VIS.update(state="ready", pct=100, msg="", path=path)
        return True, "ready"
    VIS.update(state="working", pct=0, msg="", path=path)
    threading.Thread(target=_vis_worker, args=(path, mt, cache), daemon=True).start()
    return True, "working"


def vis_data():
    import numpy as np
    mt = os.path.getmtime(NPZ_PATH)
    if _visd.get("mt") == mt:
        return _visd["d"]
    with np.load(NPZ_PATH) as z:
        def arr(k, nd):
            return np.round(z[k].astype(np.float64), nd).tolist()
        has_p = "audioPath" in z.files
        d = {"path": str(z["audioPath"]) if has_p else "", "audioMtime": int(z["audioMtime"]) if has_p else int(mt),
             "sampleRate": int(z["sampleRate"]), "blockSize": int(z["blockSize"]), "pps": float(z["peaksPerSecond"]),
             "total": int(z["totalBlocks"]), "peaks": arr("peaks", 4), "rms": arr("rms", 4), "zcr": arr("zcr", 4),
             "lows": arr("lows", 2), "mids": arr("mids", 2), "highs": arr("highs", 2), "centroid": arr("spectralCentroid", 1)}
    _visd.update(mt=mt, d=d)
    return d


# ---------------- motions.js ----------------
DEFAULT_MOTIONS = r"""/* MOTIONS - har effect ek object. draw(c, img, p, t, W, H): p = effect ka progress 0..1, t = effect start se seconds */
window.MOTIONS = [
{key:'m01', name:'Slow Zoom In', tag:'calm / shuruaat', draw(c,img,p,t,W,H){
  MX.cover(c,img,W,H,{z:1+.14*p,x:-p*24}); MX.vig(c,W,H,'rgba(0,0,0,.9)',.35)}},
{key:'m02', name:'Zoom Out Reveal', tag:'reveal / bada scene', draw(c,img,p,t,W,H){
  MX.cover(c,img,W,H,{z:1.3-.25*MX.oc(p)}); MX.flash(c,W,H,'#fff',.5*Math.exp(-t*3)); MX.vig(c,W,H,'rgba(0,0,0,.9)',.3)}},
{key:'m04', name:'Heartbeat Pulse', tag:'damage / heartbeat', draw(c,img,p,t,W,H){
  const q=t%.9,b=Math.exp(-q*9)+.65*Math.exp(-Math.pow((q-.3)*10,2));
  MX.cover(c,img,W,H,{z:1.04+.03*b}); MX.vig(c,W,H,'rgb(190,0,25)',.2+.5*b)}}
];
"""


def ensure_motions_file():
    if not os.path.isfile(MOTIONS_JS):
        with open(MOTIONS_JS, "w", encoding="utf-8") as f:
            f.write(DEFAULT_MOTIONS)
        print("motions.js ban gayi:", MOTIONS_JS)


HTML = r"""<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><title>Motion Editor</title><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Crect%20width='64'%20height='64'%20rx='14'%20fill='%236b3fa0'/%3E%3Crect%20x='9'%20y='10'%20width='46'%20height='34'%20rx='5'%20fill='%231b1e27'/%3E%3Cpath%20d='M27%2018l15%209-15%209z'%20fill='%23ffd479'/%3E%3Crect%20x='9'%20y='49'%20width='30'%20height='5'%20rx='2.5'%20fill='%237ee787'/%3E%3Crect%20x='43'%20y='49'%20width='12'%20height='5'%20rx='2.5'%20fill='%23c24bff'/%3E%3C/svg%3E">
<style>
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:#12141a;color:#e6e6e6;font:13px system-ui,sans-serif;overflow:hidden}
button{font:inherit}
#app{height:100vh;display:grid;grid-template-columns:var(--lw,290px) minmax(0,1fr) var(--rw,300px);grid-template-rows:auto minmax(0,1fr) 130px var(--th,300px)}
#bar{grid-column:1/-1;display:flex;gap:8px;align-items:center;padding:6px 10px;background:#1b1e27;border-bottom:1px solid #2b3040;flex-wrap:wrap}
#bar button,.tb button{background:#3a4152;color:#fff;border:0;border-radius:6px;padding:5px 10px;cursor:pointer}
#bar button:hover,.tb button:hover{background:#4a5370}
#bar button:disabled{opacity:.5}
#bar .sep{width:1px;height:22px;background:#3a4152}
#pname{color:#e3b3ff;font-weight:600}
#pp{background:#2d6cdf!important;min-width:76px;font-weight:600}
#rbtn{background:#238636!important}#rbtn2{background:#1f6f6f!important}
#tt{font-variant-numeric:tabular-nums;color:#ffd479;min-width:170px}
#saved{color:#7d869a;font-size:12px}#toast{margin-left:auto;color:#7ee787}#stat{color:#9fb0d0;font-size:12px}
label.ck{color:#9fb0d0;font-size:12px;display:flex;gap:4px;align-items:center}
/* library */
#lib{background:#1b1e27;border-right:1px solid #2b3040;display:grid;grid-template-rows:auto 1fr;min-height:0}
#libtop{padding:6px 8px;display:flex;flex-direction:column;gap:4px}
#libtop .row2{display:flex;gap:6px}#libtop .row2 button{flex:1;background:#2d6cdf;color:#fff;border:0;border-radius:6px;padding:6px;cursor:pointer}
#libtop .row2 button.g{background:#3a4152}
#audbox{background:#12141a;border:1px solid #2b3040;border-radius:6px;padding:3px 8px;color:#9fb0d0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#audbox b{color:#7ee787}
.tabs{display:flex;gap:4px}.tabs span{flex:1;text-align:center;padding:3px 2px;border-radius:5px;background:#262b3a;cursor:pointer;color:#9fb0d0;font-size:12px}
.tabs span.on{background:#6b3fa0;color:#fff}
#lq,#q{padding:6px 8px;border-radius:6px;border:1px solid #3a4152;background:#12141a;color:#fff;width:100%}
#libgrid{overflow:auto;padding:0 8px 8px}
.fg{margin-bottom:10px}
.fh{display:flex;align-items:center;gap:6px;padding:5px 8px;background:#2a3042;border-radius:6px;cursor:grab;position:sticky;top:0;z-index:2;font-size:12px}
.fh b{color:#e3b3ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.fh span{color:#9fb0d0}.fh .rmf{cursor:pointer}.fh .rmf:hover{color:#ff8a8a}
.fgrid{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:8px;padding-top:6px}
.fg.col .fgrid{display:none}
.mi{cursor:grab;border-radius:6px;background:#232734;overflow:hidden;border:1px solid #2b3040}
.mi:hover{border-color:#c24bff}
.mth{position:relative;aspect-ratio:16/9;background:#000}
.mth img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
.mth .bd{position:absolute;left:3px;bottom:3px;background:#000b;font-size:10px;padding:1px 5px;border-radius:3px}
.mth .rm{position:absolute;right:3px;top:3px;background:#000b;font-size:10px;padding:1px 5px;border-radius:3px;cursor:pointer;display:none}
.mi:hover .rm{display:block}
.mn{padding:3px 6px;font-size:11px;color:#cdd6e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* stage */
#center{background:#000;min-width:0;min-height:0;display:flex;flex-direction:column}
#stage{position:relative;flex:1;display:flex;align-items:center;justify-content:center;min-height:0;overflow:hidden}
#cv{background:#000;display:block}
#stage.over{outline:3px dashed #f5a524;outline-offset:-6px}
#info{flex:0 0 auto;padding:5px 12px;background:#14161d;border-top:1px solid #2b3040;font-size:12px;line-height:1.5;color:#cdd6e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#err{color:#ffb0b0;padding:10px 16px;background:#000c;border-radius:8px;position:absolute;z-index:3;display:none}
/* side */
#side{background:#1b1e27;border-left:1px solid #2b3040;display:flex;flex-direction:column;min-height:0}
#q{margin:8px;width:calc(100% - 16px)}
#list{overflow:auto;padding:0 8px 8px;flex:1 0 auto;min-height:170px}
.row{display:flex;flex-direction:column;gap:1px;padding:6px 8px;border-radius:6px;cursor:grab;border:1px solid transparent}
.row:hover{background:#262b3a}.row.cur{border-color:#c24bff}.row.pick{background:#2d3550}
.row b{color:#e3b3ff}.row b i{font-style:normal;color:#7d869a;margin-right:6px;font-weight:400}
.row span{color:#9fb0d0;font-size:11px}
#side2{border-top:1px solid #2b3040;padding:8px;background:#161922;line-height:1.5}
#side2 button{margin-top:6px;width:100%;background:#2d6cdf;color:#fff;border:0;border-radius:6px;padding:7px;cursor:pointer}
#side2 button.g{background:#3a4152}
#props{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px;font-size:11px;color:#9fb0d0}
#props input{width:100%;background:#12141a;color:#fff;border:1px solid #3a4152;border-radius:4px;padding:3px 4px}
#pt{color:#e3b3ff;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* FX lane */
#lane{grid-column:1/-1;background:#1a1d27;border-top:1px solid #2b3040;display:grid;grid-template-rows:30px 1fr;min-height:0}
#lane.off #track{opacity:.35;pointer-events:none}
#lh{display:flex;gap:14px;align-items:center;padding:0 10px;font-size:12px;color:#9fb0d0;white-space:nowrap;overflow:hidden}
#lh b{color:#e3b3ff;font-size:12px;overflow:hidden;text-overflow:ellipsis}
#lh input{width:54px;background:#12141a;color:#fff;border:1px solid #3a4152;border-radius:4px;padding:2px 4px}
#lh button{background:#6b2a2a;color:#fff;border:0;border-radius:4px;padding:2px 8px;cursor:pointer}
#fxp{display:none;gap:6px;align-items:center;margin-left:auto}#fxp.on{display:flex}
#track{position:relative;margin:0 10px 8px;background:#12141a;border-radius:5px;overflow:hidden;cursor:crosshair;user-select:none}
.lt{position:absolute;top:0;height:100%;border-left:1px solid #2b3040;padding:1px 0 0 3px;color:#6d778c;font-size:10px;pointer-events:none}
.fxb{position:absolute;height:26px;border-radius:5px;border:2px solid transparent;color:#fff;font-size:11px;line-height:22px;padding:0 8px;overflow:hidden;white-space:nowrap;cursor:grab}
.fxb.sel{border-color:#fff}
.fxb.tmp{background:repeating-linear-gradient(45deg,#c24bff55,#c24bff55 6px,#c24bff22 6px,#c24bff22 12px)!important;border:2px dashed #e3b3ff;pointer-events:none}
.fxb i{position:absolute;top:0;width:7px;height:100%;cursor:ew-resize;background:#fff3}.fxb i.hl{left:0}.fxb i.hr{right:0}
#lph,#ph{position:absolute;top:0;width:2px;height:100%;background:#ff4d4d;pointer-events:none;z-index:6;box-shadow:0 0 6px #ff4d4d}
#ph::before,#lph::before{content:'';position:absolute;top:0;left:-5px;border:6px solid transparent;border-top:9px solid #ff4d4d}
/* timeline */
#tlbox{grid-column:1/-1;display:grid;grid-template-rows:32px 1fr;min-height:0;border-top:1px solid #2b3040;background:#161922}
#tltools{display:flex;gap:6px;align-items:center;padding:3px 10px;background:#1b1e27;flex-wrap:wrap}
#tltools button{background:#3a4152;color:#fff;border:0;border-radius:5px;padding:3px 9px;cursor:pointer}
#tltools button:hover{background:#4a5370}#tltools button.on{background:#6b3fa0}
#tlwrap{min-height:0;overflow:hidden;position:relative}
#tlscroll{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden}
#tlin{display:grid;grid-template-columns:176px minmax(0,1fr)}
#rows{position:absolute;inset:0;pointer-events:none}
#hdrs{position:relative;background:#1b1e27;border-right:1px solid #2b3040}
.hd{position:absolute;left:0;width:100%;padding:3px 7px;display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-content:center;align-items:center;gap:3px 5px;color:#9fb0d0;font-size:11px;border-bottom:1px solid #232734;overflow:hidden}
.hd b{color:#e8eefc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.hd .mb{background:#2f6b3a;color:#fff;border:0;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:11px;white-space:nowrap}
.hd .mb.on{background:#b03a3a}.hd .mb.x{background:#3a4152;padding:2px 7px}
.vrow{grid-column:1/-1;display:flex;align-items:center;gap:5px}
.vrow .dbr{flex:1;min-width:0;height:14px;accent-color:#c24bff;cursor:pointer}
.vrow .db{width:48px;background:#12141a;color:#fff;border:1px solid #3a4152;border-radius:4px;padding:1px 3px;font-size:11px}
.hd.add{border:0}.hd.add button{background:#2d6cdf;color:#fff;border:0;border-radius:5px;padding:2px 8px;cursor:pointer}
.trk.mt{opacity:.55}.trk.ph0 span{color:#6d778c;font-size:11px;padding:14px;display:block}
.va,.sx{position:absolute;border-radius:4px;overflow:hidden}
.va{top:128px;height:46px;background:#1c3b5a;cursor:pointer;border:1px solid #ffffff22}
.sx{height:54px;background:#5a4a1c;cursor:grab;border:2px solid transparent}
.sx.sel{border-color:#f5a524}
.va.mt,.sx.mt{opacity:.45}
.va.noaud{opacity:.35}.va.noaud .sxt::after{content:' (audio nahi)'}
.cw{position:absolute;left:0;top:0;width:100%;height:100%}
.sxt{position:relative;padding:1px 6px;font-size:11px;color:#fff;text-shadow:0 1px 2px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.sx>i{position:absolute;top:0;width:8px;height:100%;cursor:ew-resize;background:#fff2;z-index:2}.sx>i.hl{left:0}.sx>i.hr{right:0}
.mi.pl{border-color:#7ee787}
#aprops{display:none;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:8px;font-size:11px;color:#9fb0d0;border-top:1px dashed #3a4152;padding-top:6px}
#aprops input[type=number]{width:100%;background:#12141a;color:#fff;border:1px solid #3a4152;border-radius:4px;padding:3px 4px}
#aprops b{grid-column:1/-1;color:#ffd479;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#aprops .full{grid-column:1/-1}
#aprops button{margin-top:0!important}
#lightbox .lx{position:fixed;top:14px;right:18px;background:#c0392b;color:#fff;border:0;border-radius:8px;padding:8px 16px;font-size:14px;cursor:pointer;z-index:2}
#tl{position:relative;overflow:hidden;user-select:none;cursor:default;min-height:0}
#ruler{position:absolute;left:0;top:0;height:22px;width:100%;border-bottom:1px solid #2b3040;cursor:ew-resize}
.tick{position:absolute;top:0;height:22px;border-left:1px solid #3a4152;padding-left:3px;color:#8a93a6;font-size:11px;white-space:nowrap;pointer-events:none}
.trk{position:absolute;left:0;right:0;background:#1d2130}
#wave{position:absolute;left:0;top:178px;height:64px;width:100%;pointer-events:none}
#aend{position:absolute;top:26px;height:176px;width:0;border-left:2px dashed #7ee78788;pointer-events:none;z-index:4}
#aend span{position:absolute;top:-1px;left:3px;font-size:10px;color:#7ee787}
#ghost{position:absolute;top:28px;height:96px;background:#f5a52444;border:2px dashed #f5a524;border-radius:5px;display:none;pointer-events:none;z-index:5}
.clip{position:absolute;top:28px;height:96px;border-radius:5px;overflow:hidden;cursor:grab;border:2px solid transparent;font-size:12px;background:#265b3a}
.clip.video{background:#27456f}.clip.miss{background:#6b2a2a}.clip.sel{border-color:#f5a524}
.cth{position:absolute;inset:0;background-size:auto 100%;background-repeat:repeat-x;opacity:1}
.ctx{position:relative;padding:3px 7px;line-height:1.4;text-shadow:0 1px 2px #000;pointer-events:none;background:linear-gradient(180deg,#000b,#0000)}
.ctx b{color:#f6e3ff;font-size:12px}.ctx .ix{color:#cfe;margin-left:5px;font-size:11px}
.ctx small{display:block;color:#e4ebf7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.clip.n2 small{display:none}.clip.n1 .ctx{display:none}
.clip>i{position:absolute;top:0;width:9px;height:100%;cursor:ew-resize;background:#fff2;z-index:2}.clip>i:hover{background:#fff7}
.clip>i.hl{left:0}.clip>i.hr{right:0}
.fxs{position:absolute;left:0;right:0;bottom:0;height:7px;background:#0006}
.fxs div{position:absolute;top:0;height:100%;background:#c24bff}
#rtabs{display:flex;gap:4px;padding:8px 8px 0}
#rtabs span{flex:1;text-align:center;padding:6px 4px;border-radius:6px;background:#262b3a;cursor:pointer;color:#9fb0d0;font-size:12px}
#rtabs span.on{background:#6b3fa0;color:#fff}
#visbox{margin:6px 8px 0;padding:6px 8px;background:#12141a;border:1px solid #2b3040;border-radius:6px;font-size:12px;color:#9fb0d0;line-height:1.5;word-break:break-all}
#visbox button{margin-top:4px;width:100%;background:#2d6cdf;color:#fff;border:0;border-radius:6px;padding:4px;cursor:pointer}
#lhv{display:none;gap:14px;align-items:center;padding:0 10px;font-size:12px;color:#9fb0d0;white-space:nowrap;overflow:hidden}
#lhv b{color:#7ee787;font-size:12px;overflow:hidden;text-overflow:ellipsis}
#lhv input{width:62px;background:#12141a;color:#fff;border:1px solid #3a4152;border-radius:4px;padding:2px 4px}
#lhv button{background:#6b2a2a;color:#fff;border:0;border-radius:4px;padding:2px 8px;cursor:pointer}
.vp{display:none;gap:6px;align-items:center;margin-left:auto}.vp.on{display:flex}
#vh{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border:2px solid #7ee787;border-radius:50%;background:#7ee78733;cursor:move;display:none;z-index:4}
#vh::before,#vh::after{content:'';position:absolute;background:#7ee787}
#vh::before{left:11px;top:3px;width:2px;height:18px}#vh::after{top:11px;left:3px;height:2px;width:18px}
.vxs{position:absolute;left:0;right:0;bottom:7px;height:5px;background:#0006}
.vxs div{position:absolute;top:0;height:100%;background:#7ee787}
#bigpop{position:fixed;display:none;background:#232734;border:1px solid #6b3fa0;border-radius:8px;overflow:hidden;z-index:60;pointer-events:none;box-shadow:0 10px 30px #000c}
#bigpop .bm{background:#000;display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;max-height:62vh}
#bigpop img,#bigpop video{max-width:100%;max-height:100%;object-fit:contain}
#bigpop .bt{padding:8px 10px;font-size:12px;line-height:1.5;color:#e6e6e6;word-break:break-all}
#lightbox{position:fixed;inset:0;background:#000e;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;z-index:120}
#lightbox.on{display:flex}
#lightbox .lb{display:flex;align-items:center;justify-content:center;max-width:96vw;max-height:90vh}
#lightbox img,#lightbox video{max-width:96vw;max-height:88vh;object-fit:contain}
#lightbox .lc{color:#9fb0d0;font-size:12px;max-width:94vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#center{position:relative}
#fsbar{position:absolute;left:0;right:0;bottom:0;display:none;gap:12px;align-items:center;padding:10px 16px;background:linear-gradient(transparent,#000c);z-index:10}
#fsbar button{background:#3a4152;color:#fff;border:0;border-radius:6px;padding:6px 14px;cursor:pointer}
#fsbar input{flex:1}#fsbar span{color:#ffd479;font-variant-numeric:tabular-nums;min-width:110px;text-align:right}
#center:fullscreen #fsbar.show{display:flex}
#center:-webkit-full-screen #fsbar.show{display:flex}
#center:fullscreen #info,#center:fullscreen #vh{display:none!important}
#center:-webkit-full-screen #info,#center:-webkit-full-screen #vh{display:none!important}
#side{overflow-y:auto}
#side.vis #props{display:none}
.vpth{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#6d778c;font-size:11px}
.sp{position:absolute;z-index:20}.sp:hover,.sp.act{background:#6b3fa0aa}
#spL{left:0;top:0;bottom:0;width:6px;cursor:col-resize}#spR{right:0;top:0;bottom:0;width:6px;cursor:col-resize}#spB{left:0;right:0;bottom:0;height:6px;cursor:row-resize}
#center:fullscreen .sp{display:none}#center:-webkit-full-screen .sp{display:none}
#tabs span.sz{flex:0 0 26px;padding:3px 0}
/* modal */
#modal{position:fixed;inset:0;background:#000a;display:none;align-items:center;justify-content:center;z-index:100}
#modal.on{display:flex}
#mbox{background:#1d212c;border:1px solid #4a5370;border-radius:10px;width:min(760px,94vw);max-height:86vh;display:flex;flex-direction:column;overflow:hidden}
.mh{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #2b3040}
.mh .x{cursor:pointer;color:#9fb0d0;padding:0 6px}
.mp{display:flex;gap:6px;padding:8px 12px}.mp input{flex:1;background:#12141a;color:#fff;border:1px solid #3a4152;border-radius:6px;padding:6px 8px}
.mp button,.mf button{background:#3a4152;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer}
.mf{display:flex;gap:8px;align-items:center;padding:10px 12px;border-top:1px solid #2b3040;flex-wrap:wrap}
.mf button.p{background:#2d6cdf}
.ml{overflow:auto;flex:1;padding:0 8px 8px;min-height:200px}
.mr{display:flex;gap:8px;align-items:center;padding:5px 8px;border-radius:5px;cursor:pointer}
.mr:hover{background:#262b3a}.mr small{margin-left:auto;color:#7d869a}
.mb{padding:12px 14px;display:grid;grid-template-columns:130px 1fr;gap:8px;align-items:center}
.mb input{background:#12141a;color:#fff;border:1px solid #3a4152;border-radius:6px;padding:6px 8px}
</style></head><body>
<div id="app">
  <div id="bar">
    <span id="pname">project</span>
    <button onclick="newProject()">New</button><button onclick="openProjects()">Open</button>
    <button onclick="saveNow()">Save</button><button onclick="saveAs()">Save As</button><button onclick="openSettings()">⚙</button>
    <span id="saved"></span><span class="sep"></span>
    <button id="pp" onclick="togglePlay()">▶ Play</button><span id="tt">0:00.0</span><button id="maxb" onclick="toggleMax()" title="M">⛶ Max view</button>
    <span class="sep"></span>
    <button id="rbtn" onclick="renderFull()">🎬 Full video render</button>
    <button id="rbtn2" onclick="renderSelected()">💾 Selected item render</button>
    <label class="ck"><input type="checkbox" id="cache" checked>purane render reuse</label>
    <button onclick="exportPy()">→ animate_data_new.py</button>
    <span id="stat"></span><span id="toast"></span>
  </div>
  <div id="lib">
    <div id="libtop">
      <div class="row2"><button onclick="openBrowser('media')">＋ Import</button><button class="g" onclick="openBrowser('audio')" title="main audio chuno">🔊 Main audio</button></div>
      <div id="audbox"></div>
      <div class="tabs" id="tabs"><span data-t="all" class="on">All</span><span data-t="image">Img</span><span data-t="video">Vid</span><span data-t="audio">Aud</span><span class="sz" data-s="1" title="bade thumbnails">▢</span><span class="sz" data-s="2" title="medium">▦</span><span class="sz" data-s="3" title="chhote">▩</span></div>
      <input id="lq" placeholder="Library search">
    </div>
    <div id="libgrid"></div>
  </div>
  <div id="center"><div class="sp" id="spL" title="library ki chaudai"></div><div class="sp" id="spR" title="right panel ki chaudai"></div><div class="sp" id="spB" title="preview / timeline ki unchai (drag)"></div><div id="stage"><canvas id="cv"></canvas><div id="err"></div><div id="vh" title="animation ki position: drag karo"></div></div>
  <div id="info">Library se image/video timeline me drag karo</div>
  <div id="fsbar"><button id="fspp" onclick="togglePlay()">▶</button><input id="fsseek" type="range" min="0" max="1000" value="0"><span id="fstt">0:00</span><button onclick="toggleMax()">✕ Exit</button></div></div>
  <div id="side">
    <div id="rtabs"><span data-t="fx" class="on">🖼 Image effects</span><span data-t="vis">🎧 Audio animations</span></div>
    <div id="visbox" style="display:none"><div id="visinfo"></div><button onclick="openBrowser('audio',undefined,'vis')">🎙 Analysis audio chuno (raw voice)</button></div>
    <input id="q" placeholder="Motion search (naam / key / tag)">
    <div id="list"></div>
    <div id="side2">
      <div id="dt">Effect par click = playhead se preview (play hota hai)</div>
      <button id="apply" onclick="applyPick()">Effect lagao</button>
      <button class="g" onclick="location.reload()">↻ reload (motions.js + audio_animations.js)</button>
      <div id="props"><b id="pt" style="grid-column:1/-1">Clip chuno</b>
        <label>Start<input id="ps" type="number" step="0.05" min="0"></label>
        <label>Length<input id="pd" type="number" step="0.05" min="0.2"></label>
        <label>In (video)<input id="pin" type="number" step="0.05" min="0"></label></div>
      <div id="aprops"><b id="apt">Audio</b>
        <label>Vol (dB)<input id="ap_vol" type="number" step="1"></label>
        <label class="fx">Fade in (s)<input id="ap_fi" type="number" step="0.1" min="0"></label>
        <label class="fx">Fade out (s)<input id="ap_fo" type="number" step="0.1" min="0"></label>
        <label class="fx">Start<input id="ap_s" type="number" step="0.05" min="0"></label>
        <label class="fx">Length<input id="ap_d" type="number" step="0.05" min="0.1"></label>
        <label class="fx">In<input id="ap_in" type="number" step="0.05" min="0"></label>
        <label class="full"><input type="checkbox" id="ap_m"> Mute</label>
        <button class="g fx full" id="ap_del" style="background:#6b2a2a">🗑 SFX hatao</button></div>
    </div>
  </div>
  <div id="lane" class="off">
    <div id="lh">
      <b id="lt">Timeline se image clip chuno</b>
      <label>Fade <input id="fade" type="number" min="0" max="2" step="0.05" value="0.35">s</label>
      <label>Default length <input id="deflen" type="number" min="0" step="0.5" value="0">s <span title="0 = agle effect ya clip end tak">(0 = auto)</span></label>
      <span id="fxp">Start <input id="fs" type="number" step="0.05" min="0">s &nbsp;Length <input id="fd" type="number" step="0.05" min="0.1">s <button id="fdel">Delete</button></span>
    </div>
    <div id="lhv">
      <b id="ltv">Timeline se clip chuno</b>
      <span id="vxp" class="vp">Start <input id="vs_s" type="number" step="0.05" min="0">s &nbsp;Length <input id="vs_d" type="number" step="0.05" min="0.1">s &nbsp;X <input id="vs_x" type="number" step="1"> Y <input id="vs_y" type="number" step="1"> Size <input id="vs_k" type="number" step="0.05" min="0.1"> <button id="vdel">Delete</button></span>
    </div>
    <div id="track"></div>
  </div>
  <div id="tlbox">
    <div id="tltools" class="tb">
      <button onclick="splitAtPlayhead()" title="S">✂ Split</button>
      <button onclick="S.selA?deleteA(S.selA):deleteClip(S.sel,false)" title="Delete">🗑 Delete</button>
      <button onclick="deleteClip(S.sel,true)" title="Shift+Delete">⇥ Ripple delete</button>
      <button onclick="closeGaps()">Gaps band karo</button>
      <button onclick="fillToAudio()">⤓ Last image → audio end</button>
      <button onclick="copySel()" title="Ctrl+C">⎘ Copy</button><button onclick="pasteClip()" title="Ctrl+V">⎗ Paste</button><button onclick="duplicateSel()" title="Ctrl+D">⧉ Duplicate</button><button onclick="addTrack()">＋ SFX track</button>
      <button onclick="undo()" title="Ctrl+Z">↶</button><button onclick="redo()" title="Ctrl+Shift+Z">↷</button>
      <button id="snapb" class="on" onclick="toggleSnap()">🧲 Snap</button>
      <button onclick="zoomBy(1/1.4)">−</button><button onclick="zoomBy(1.4)">＋</button><button onclick="fit()">Fit (F)</button>
      <span style="color:#6d778c;font-size:11px">Space play · S split · Del delete · Ctrl+C/V/D copy-paste-duplicate · ←/→ frame · Shift+←/→ 1s · ↑/↓ clip edge · wheel zoom · shift+wheel pan · Alt+wheel = tracks upar/neeche</span>
    </div>
    <div id="tlwrap">
      <div id="tlscroll"><div id="tlin">
        <div id="hdrs"></div>
        <div id="tl"><div id="ruler"></div><div id="rows"></div>
          <canvas id="wave"></canvas><div id="aend"><span>audio end</span></div><div id="ghost"></div><div id="ph"></div></div>
      </div></div>
    </div>
  </div>
</div>
<div id="modal"><div id="mbox"></div></div>
<div id="bigpop"><div class="bm"></div><div class="bt"></div></div>
<div id="lightbox"><button class="lx" onclick="closeLightbox()" title="Esc">✕ Close</button><div class="lb"></div><div class="lc"></div></div>

<script>
/* ===== MX: effects ke helpers (motions.js me use hote hain) ===== */
const MX={
  clamp:(x,a=0,b=1)=>Math.min(b,Math.max(a,x)),lerp:(a,b,t)=>a+(b-a)*t,
  oc:t=>1-Math.pow(1-t,3),io:t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,
  rng:s=>()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296},
  cover(c,img,W,H,o={}){const s=Math.max(W/img.naturalWidth,H/img.naturalHeight)*(o.z||1);
    c.save();c.translate(W/2+(o.x||0),H/2+(o.y||0));c.rotate(o.r||0);c.scale(s,s);c.drawImage(img,-img.naturalWidth/2,-img.naturalHeight/2);c.restore()},
  vig(c,W,H,col,a){if(a<=0)return;const g=c.createRadialGradient(W/2,H/2,H*.3,W/2,H/2,H*.95);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,col);c.globalAlpha=Math.min(1,a);c.fillStyle=g;c.fillRect(0,0,W,H);c.globalAlpha=1},
  flash(c,W,H,col,a){if(a<=0)return;c.globalAlpha=Math.min(1,a);c.fillStyle=col;c.fillRect(0,0,W,H);c.globalAlpha=1},
  glow(c,x,y,r,col,a){if(r<=0)return;const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,col);g.addColorStop(1,'rgba(0,0,0,0)');
    c.globalCompositeOperation='lighter';c.globalAlpha=Math.min(1,a);c.fillStyle=g;c.fillRect(x-r,y-r,2*r,2*r);c.globalAlpha=1;c.globalCompositeOperation='source-over'},
  bolt(r,x0,y0,x1,y1,n,j){const p=[[x0,y0]];for(let i=1;i<n;i++){const t=i/n;p.push([x0+(x1-x0)*t+(r()-.5)*j,y0+(y1-y0)*t+(r()-.5)*j*.3])}p.push([x1,y1]);return p},
  path(c,p){c.beginPath();p.forEach((q,i)=>i?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]));c.stroke()}
};
window.MOTIONS=[];
</script>
<script src="/motions.js"></script>
<script src="/audio_animations.js"></script>
<script src="/motion_kit.js"></script>
<script>
const $=id=>document.getElementById(id);
const PAD=8,TOPV=28,VHT=96;
let W=1280,H=720,FPS=25;
const S={P:null,file:'',root:'',sel:null,time:0,playing:false,vs:0,scale:10,total:10,hist:[],fut:[],
  tryKey:null,tryStart:0,fxObj:null,pick:null,dragKey:null,dragMedia:null,snap:true,fade:.35,els:{},
  peaks:null,libTab:'all',audioOK:false,audioPath:'',vid:null,vclip:null,vtried:false,lastDir:'',selA:null,clipb:null,sxEls:{},vaEls:{},lastTrack:0,tab:'fx',pickV:null,visData:null,visSig:'none',visStat:'',visBusy:'',dragVis:null,dragFolder:null,numpy:true};
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const r3=x=>Math.round(x*1000)/1000;
const q05=x=>Math.round(x*20)/20;
const base=p=>(p||'').split(/[\\/]/).pop();
const dirname=p=>(p||'').replace(/[\\/][^\\/]*$/,'');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const uid=()=>'c'+Math.random().toString(36).slice(2,8);
const fmt=t=>Math.floor(t/60)+':'+(t%60).toFixed(1).padStart(4,'0');
const fmtS=t=>{t=Math.max(0,t);const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60);return h?h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'):m+':'+String(s).padStart(2,'0')};
const mot=k=>MOTIONS.find(m=>m.key===k);
const mname=k=>k?(mot(k)?mot(k).name:k+' (?)'):'—';
const hue=k=>{let h=0;for(const ch of String(k))h=(h*31+ch.charCodeAt(0))%360;return h};
const fileUrl=p=>'/file?p='+encodeURIComponent(p);
const thumbUrl=(p,t,w)=>'/thumb?p='+encodeURIComponent(p)+'&t='+t+'&w='+w;
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});return r.json()}
function toast(t){const e=$('toast');e.textContent=t;clearTimeout(toast.t);toast.t=setTimeout(()=>e.textContent='',3500)}
const LC=document.createElement('canvas');const lcx=LC.getContext('2d');
const au=new Audio();au.preload='metadata';
const warned=new WeakSet();
const byId=id=>S.P.clips.find(c=>c.id===id);
const curClip=()=>byId(S.sel);
const clipAt=t=>S.P.clips.find(c=>t>=c.start&&t<c.start+c.duration-1e-9);
const contentEnd=()=>Math.max(0,...S.P.clips.map(c=>c.start+c.duration));
const audioDur=()=>S.P.audio.duration||0;
function computeTotal(){const e=Math.max(contentEnd(),...S.P.aclips.map(x=>x.start+x.duration)),a=audioDur();S.total=Math.max(a||0,e,a?0:10,1)}

/* ================= effects logic (purana code, clip based) ================= */
function fxList(d,withTry){
  const a=(d.effects||[]).slice();
  if(withTry&&S.tryKey){a.push({key:S.tryKey,start:S.tryStart,dur:Math.max(.3,d.duration-S.tryStart),tmp:1})}
  return a.map((e,i)=>[e,i]).sort((x,y)=>x[0].start-y[0].start||x[1]-y[1]).map(x=>x[0]);
}
function drawSeg(c,img,d,T,list){
  c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';c.fillStyle='#000';c.fillRect(0,0,W,H);
  if(!(img.complete&&img.naturalWidth))return;
  MX.cover(c,img,W,H);
  const xf=S.fade,sd=d.duration;
  for(const e of list){
    const t=T-e.start,end=e.start+e.dur;
    const adj=list.some(o=>o!==e&&o.start>=end-.05&&o.start<=end+.05);
    if(t<0||t>e.dur+(adj?xf:0))continue;
    const m=mot(e.key);if(!m)continue;
    let a=1;
    if(xf>0){
      if(e.start>.01)a=Math.min(a,t/xf);
      if(!adj&&end<sd-.01)a=Math.min(a,(e.dur-t)/xf);
    }
    a=clamp(a,0,1);if(a<=0)continue;
    lcx.setTransform(1,0,0,1,0,0);lcx.globalAlpha=1;lcx.globalCompositeOperation='source-over';lcx.fillStyle='#000';lcx.fillRect(0,0,W,H);
    try{m.draw(lcx,img,clamp(t/e.dur,0,1),Math.max(0,t),W,H)}catch(err){MX.cover(lcx,img,W,H);if(!warned.has(e)){warned.add(e);console.error('Effect '+e.key,err)}}
    c.globalAlpha=a;c.drawImage(LC,0,0);c.globalAlpha=1;
  }
}
function addFxData(d,key,startLocal,defLen){
  const sd=d.duration,s=q05(clamp(startLocal,0,Math.max(0,sd-.3)));
  const fx=d.effects||(d.effects=[]);
  for(let i=fx.length-1;i>=0;i--)if(Math.abs(fx[i].start-s)<.05)fx.splice(i,1);
  for(const e of fx)if(e.start<s-.001&&e.start+e.dur>s+.001)e.dur=Math.max(.3,+(s-e.start).toFixed(2));
  let end=sd;const nx=fx.filter(e=>e.start>s+.001).map(e=>e.start);if(nx.length)end=Math.min(end,Math.min(...nx));
  if(defLen>0)end=Math.min(end,s+defLen);
  const ne={key,start:+s.toFixed(2),dur:+Math.max(.3,end-s).toFixed(2)};
  fx.push(ne);fx.sort((a,b)=>a.start-b.start);
  return ne;
}
/* effects ko [a,b) window me kaato, 0 se shift karo (trim / split ke liye) */
function sliceFx(fx,a,b){
  const out=[];for(const e of fx||[]){const s=Math.max(e.start,a),en=Math.min(e.start+e.dur,b);
    if(en-s>=.1)out.push(Object.assign({},e,{start:+(s-a).toFixed(2),dur:+(en-s).toFixed(2)}))}
  return out;
}
function resizeFx(fx,d0,nd){const f=JSON.parse(JSON.stringify(fx||[]));
  if(nd>d0)f.forEach(e=>{if(e.start+e.dur>=d0-.05)e.dur=+(nd-e.start).toFixed(2)});return sliceFx(f,0,nd)}

/* ================= project / save ================= */
function normClip(c){
  c.start=r3(Math.max(0,c.start));c.duration=r3(Math.max(.1,c.duration));c.end=r3(c.start+c.duration);
  c.output=`${+c.start.toFixed(2)}_${+c.end.toFixed(2)}`;
  if(c.type==='image'){c.in=0;c.out=c.duration;c.effects=c.effects||[];c.motion=c.effects.length?c.effects[0].key:''}
  else{c.in=r3(c.in||0);c.out=r3(c.in+c.duration);delete c.effects;delete c.motion}
  if(c.vis&&c.vis.length)c.vis.forEach(v=>{if(!v.id)v.id=uid()});else delete c.vis;
}
let saveT=null;
function scheduleSave(){$('saved').textContent='● unsaved';clearTimeout(saveT);saveT=setTimeout(saveNow,700)}
async function saveNow(as){
  clearTimeout(saveT);S.P.clips.forEach(normClip);
  try{const r=await api('/api/save',{project:S.P,as:as||''});if(!r.ok)throw 0;S.file=r.file;$('saved').textContent='saved ✓ '+r.file;$('pname').textContent=S.P.name+'  ('+r.file+')'}
  catch(e){$('saved').textContent='⚠ save error'}
}
function saveAs(){const n=prompt('Naye project ka naam:',S.P.name);if(!n)return;S.P.name=n;saveNow(n)}
function pushUndo(){S.hist.push(JSON.stringify(S.P));if(S.hist.length>80)S.hist.shift();S.fut=[]}
function undo(){if(!S.hist.length)return toast('undo ke liye kuch nahi');S.fut.push(JSON.stringify(S.P));S.P=JSON.parse(S.hist.pop());S.fxObj=null;S.tryKey=null;afterLoad(true);scheduleSave()}
function redo(){if(!S.fut.length)return;S.hist.push(JSON.stringify(S.P));S.P=JSON.parse(S.fut.pop());S.fxObj=null;afterLoad(true);scheduleSave()}
function afterLoad(keepView){
  const P=S.P;
  P.settings=Object.assign({width:1280,height:720,fade:.35,fps:25,image_len:5,root_folder:S.root},P.settings||{});
  P.audio=P.audio||{path:'',name:'',duration:0};P.media=P.media||[];P.clips=P.clips||[];
  P.audio.vol=+P.audio.vol||0;P.audio.mute=!!P.audio.mute;P.atracks=P.atracks||[];P.aclips=P.aclips||[];P.vtrack=Object.assign({mute:false,vol:0},P.vtrack||{});
  W=+P.settings.width||1280;H=+P.settings.height||720;FPS=+P.settings.fps||25;S.fade=+P.settings.fade;$('fade').value=S.fade;
  LC.width=W;LC.height=H;S.cv.width=W;S.cv.height=H;fitStage();
  if(S.sel&&!byId(S.sel))S.sel=null;
  loadAudio();renderLib();renderAudBox();VRT={};renderVisBox();ensureVis();
  $('pname').textContent=P.name+'  ('+S.file+')';
  changed(true);if(!keepView){fit();restoreView()}
}
function changed(nosave){
  S.P.clips.sort((a,b)=>a.start-b.start);S.P.clips.forEach(normClip);S.P.aclips.forEach(normA);pruneAudio();
  computeTotal();buildTimeline();renderLane();renderList();updateProps();updateStat();
  if(!nosave)scheduleSave();
}
function resetSession(){S.hist=[];S.fut=[];S.sel=null;S.selA=null;S.fxObj=null;S.tryKey=null;S.time=0;setPlaying(false)}
async function newProject(){const n=prompt('Naye project ka naam:','project');if(!n)return;const r=await api('/api/new',{name:n});S.P=r.project;S.file=r.file;resetSession();afterLoad()}
async function openProjects(){
  const r=await api('/api/projects');let h='<div class="mh"><b>Project kholo</b><span class="x" onclick="closeModal()">✕</span></div><div class="ml">';
  if(!r.projects.length)h+='<div class="mr">Koi project file nahi mili</div>';
  r.projects.forEach(p=>h+=`<div class="mr" data-f="${esc(p.file)}">📄 ${esc(p.name)} <small>${esc(p.file)} · ${p.clips} clips · ${esc(p.modified)}</small></div>`);
  h+=`</div><div class="mf"><span style="color:#9fb0d0">Purana animate_data.json / .py import:</span><input id="oldp" style="flex:1;background:#12141a;color:#fff;border:1px solid #3a4152;border-radius:6px;padding:6px" placeholder="animate_data.json (khali = default)"><button onclick="importOld()">Import</button></div>`;
  $('mbox').innerHTML=h;$('modal').classList.add('on');
  $('mbox').querySelectorAll('[data-f]').forEach(e=>e.onclick=async()=>{const o=await api('/api/open',{file:e.dataset.f});if(!o.ok)return toast('open error');S.P=o.project;S.file=o.file;closeModal();resetSession();afterLoad()});
}
async function importOld(){
  if(!confirm('Current project ki timeline purane data se badal jayegi. Aage badhein?'))return;
  const r=await api('/api/import_old',{path:$('oldp').value.trim()});if(!r.ok)return toast(r.error||'import fail');
  const keepAudio=S.P.audio;S.P=r.project;if(keepAudio&&keepAudio.path)S.P.audio=keepAudio;S.P.name=S.P.name||'imported';
  closeModal();resetSession();afterLoad();scheduleSave();toast('✓ '+S.P.clips.length+' clips import hue')
}
function closeModal(){$('modal').classList.remove('on')}
function openSettings(){
  const s=S.P.settings;
  $('mbox').innerHTML=`<div class="mh"><b>⚙ Project settings</b><span class="x" onclick="closeModal()">✕</span></div><div class="mb">
  <span>Project naam</span><input id="s_name" value="${esc(S.P.name)}">
  <span>Width × Height</span><div style="display:flex;gap:6px"><input id="s_w" type="number" value="${s.width}" style="width:90px"><input id="s_h" type="number" value="${s.height}" style="width:90px"></div>
  <span>FPS</span><input id="s_fps" type="number" value="${s.fps}">
  <span>Fade (sec)</span><input id="s_fade" type="number" step="0.05" value="${s.fade}">
  <span>Image default length</span><input id="s_il" type="number" step="0.5" value="${s.image_len}">
  <span>Root folder</span><input id="s_root" value="${esc(s.root_folder||'')}"></div>
  <div class="mf"><button class="p" onclick="applySettings()">Save</button></div>`;
  $('modal').classList.add('on');
}
function applySettings(){
  pushUndo();const s=S.P.settings;S.P.name=$('s_name').value||S.P.name;
  s.width=+$('s_w').value||1280;s.height=+$('s_h').value||720;s.fps=+$('s_fps').value||25;s.fade=+$('s_fade').value||0;
  s.image_len=+$('s_il').value||5;s.root_folder=$('s_root').value||s.root_folder;closeModal();afterLoad(true);scheduleSave()
}
async function exportPy(){await saveNow();const r=await api('/api/export',{project:S.P});toast('Saved: '+r.file)}

/* ================= library + file browser ================= */
function renderAudBox(){
  const a=S.P.audio,b=$('audbox');
  b.title=a.path||'';
  b.innerHTML=a.path?`🔊 <b>${esc(a.name||base(a.path))}</b> · ${a.duration?fmtS(a.duration):'...'}`:'🔊 main audio nahi chuni';
}
function renderLib(){
  const q=$('lq').value.toLowerCase(),f=S.libTab,box=$('libgrid');box.innerHTML='';
  S.collapsed=S.collapsed||{};
  const groups={},order=[];
  S.P.media.filter(m=>(f==='all'||m.type===f)&&(m.name+m.path).toLowerCase().includes(q)).forEach(m=>{
    const d=dirname(m.path);if(!groups[d]){groups[d]=[];order.push(d)}groups[d].push(m)});
  order.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  order.forEach(d=>{
    const items=groups[d],fg=document.createElement('div');fg.className='fg'+(S.collapsed[d]?' col':'');
    const h=document.createElement('div');h.className='fh';h.draggable=true;
    h.innerHTML=`<span>${S.collapsed[d]?'▸':'▾'}</span><b title="${esc(d)}">📁 ${esc(base(d)||d)}</b><span>${items.length}</span><span class="rmf" title="folder library se hatao">✕</span>`;
    h.onclick=ev=>{if(ev.target.classList.contains('rmf'))return;S.collapsed[d]=!S.collapsed[d];renderLib()};
    h.ondragstart=ev=>{S.dragMedia=null;S.dragKey=null;S.dragFolder=items.filter(m=>m.type!=='audio');ev.dataTransfer.setData('text/plain','folder');ev.dataTransfer.effectAllowed='copy'};
    h.ondragend=()=>{S.dragFolder=null;$('ghost').style.display='none'};
    h.querySelector('.rmf').onclick=ev=>{ev.stopPropagation();if(!confirm('"'+(base(d)||d)+'" folder library se hataein? (timeline ke clips nahi hatenge)'))return;
      S.P.media=S.P.media.filter(m=>dirname(m.path)!==d);renderLib();scheduleSave()};
    fg.appendChild(h);
    const grid=document.createElement('div');grid.className='fgrid';
    items.forEach(m=>{
      const e=document.createElement('div');e.className='mi';e.draggable=true;
      const th=m.type==='audio'?'<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:28px">🔊</div>':`<img loading="lazy" src="${thumbUrl(m.path,1,200)}" onerror="this.style.display='none'">`;
      e.innerHTML=`<div class="mth">${th}<span class="bd">${m.type==='image'?'🖼':(m.type==='video'?'🎬 ':'🔊 ')+(m.duration?fmtS(m.duration):'')}</span><b class="rm" title="library se hatao">✕</b></div><div class="mn" title="${esc(m.path)}">${esc(m.name)}</div>`;
      e.ondragstart=ev=>{hideBig();S.dragMedia=m;S.dragFolder=null;S.dragKey=null;ev.dataTransfer.setData('text/plain','media');ev.dataTransfer.effectAllowed='copy'};
      e.ondragend=()=>{S.dragMedia=null;$('ghost').style.display='none'};
      e.ondblclick=()=>{clearTimeout(e._ct);hideBig();if(m.type==='audio')addSfx(m,S.time,S.lastTrack||0);else addMedia(m,contentEnd())};
      e.onclick=()=>{clearTimeout(e._ct);if(m.type==='audio'){previewAudio(m,e);return}e._ct=setTimeout(()=>openLightbox(m),260)};
      e.onmouseenter=()=>showBig(m,e);e.onmouseleave=hideBig;
      e.querySelector('.rm').onclick=ev=>{ev.stopPropagation();S.P.media=S.P.media.filter(x=>x!==m);renderLib();scheduleSave()};
      grid.appendChild(e);
    });
    fg.appendChild(grid);box.appendChild(fg);
  });
  if(!order.length)box.innerHTML='<div style="color:#6d778c;padding:10px;font-size:12px">Library khali hai. ＋ Image / Video import se folder chuno.</div>';
}
$('lq').oninput=renderLib;
$('tabs').onclick=e=>{
  if(e.target.dataset.s){setCols(+e.target.dataset.s);return}
  const t=e.target.dataset.t;if(!t)return;S.libTab=t;[...$('tabs').children].forEach(x=>{if(x.dataset.t)x.classList.toggle('on',x===e.target)});renderLib()};
async function importMedia(items){
  let n=0;for(const it of items){if(S.P.media.some(m=>m.path===it.path))continue;S.P.media.push({path:it.path,type:it.type,name:it.name||base(it.path),duration:0});n++}
  renderLib();scheduleSave();toast(n+' file library me aayi');
  for(const m of S.P.media){if(m.type!=='image'&&!m.duration){try{const p=await api('/api/probe?p='+encodeURIComponent(m.path));if(p.duration){m.duration=r3(p.duration);renderLib()}}catch(e){}}}
  scheduleSave();
}
const MB={mode:'media',data:null,sel:new Map(),dsel:new Map()};
async function openBrowser(mode,path,target){
  MB.mode=mode;if(!path){MB.sel=new Map();MB.dsel=new Map();MB.target=target||'main'}
  const start=path||S.lastDir||(mode==='audio'&&S.P.audio.path?dirname(S.P.audio.path):'')||S.P.settings.root_folder||S.root;
  const r=await api('/api/ls?mode='+mode+'&path='+encodeURIComponent(start));S.lastDir=r.path;MB.data=r;drawBrowser();
}
function drawBrowser(){
  const r=MB.data,au_=MB.mode==='audio',box=$('mbox');
  const ic={image:'🖼',video:'🎬',audio:'🔊'};
  let rows='';
  r.dirs.forEach((d,i)=>rows+=`<div class="mr" data-d="${i}">${au_?'':`<input type="checkbox" data-dc="${i}" ${MB.dsel.has(d.path)?'checked':''} title="folder select karo">`}📁 ${esc(d.name)}</div>`);
  r.files.forEach((f,i)=>rows+=`<label class="mr"><input type="checkbox" data-f="${i}" ${MB.sel.has(f.path)?'checked':''}> ${ic[f.type]||''} ${esc(f.name)}<small>${(f.size/1048576).toFixed(1)} MB</small></label>`);
  if(!r.dirs.length&&!r.files.length)rows='<div class="mr">(khali)</div>';
  box.innerHTML=`<div class="mh"><b>${au_?'🔊 Audio file chuno':'＋ Image / Video / Audio import (folder ke checkbox se poora folder)'}</b><span class="x" onclick="closeModal()">✕</span></div>
  <div class="mp"><button id="mup">⬆</button><button id="mroot">🏠 root</button><input id="mpath" value="${esc(r.path)}"></div>
  <div class="ml" id="ml">${rows}</div>
  <div class="mf">${au_?'<button class="p" id="mgo">Audio lagao</button>':
   '<button id="mall">☑ sab files</button><button id="mdall">☑ sab folders</button><button class="p" id="mgo">Selected import</button><label class="ck"><input type="checkbox" id="mrec" checked>subfolders bhi</label><span id="mcnt" style="color:#9fb0d0;margin-left:auto"></span>'}</div>`;
  $('modal').classList.add('on');
  const cnt=()=>{if($('mcnt'))$('mcnt').textContent=MB.sel.size+' files · '+MB.dsel.size+' folders chune'};cnt();
  $('mup').onclick=()=>r.parent&&openBrowser(MB.mode,r.parent);
  $('mroot').onclick=()=>openBrowser(MB.mode,S.P.settings.root_folder||S.root);
  $('mpath').onkeydown=e=>{if(e.key==='Enter')openBrowser(MB.mode,e.target.value)};
  $('ml').querySelectorAll('[data-d]').forEach(e=>e.onclick=ev=>{if(ev.target.tagName==='INPUT')return;openBrowser(MB.mode,r.dirs[+e.dataset.d].path)});
  $('ml').querySelectorAll('[data-dc]').forEach(e=>e.onchange=()=>{const d=r.dirs[+e.dataset.dc];if(e.checked)MB.dsel.set(d.path,d);else MB.dsel.delete(d.path);cnt()});
  $('ml').querySelectorAll('[data-f]').forEach(e=>e.onchange=()=>{
    const f=r.files[+e.dataset.f];
    if(au_){MB.sel=new Map();$('ml').querySelectorAll('[data-f]').forEach(x=>{if(x!==e)x.checked=false})}
    if(e.checked)MB.sel.set(f.path,f);else MB.sel.delete(f.path);cnt()});
  if($('mall'))$('mall').onclick=()=>{$('ml').querySelectorAll('[data-f]').forEach(e=>{e.checked=true;MB.sel.set(r.files[+e.dataset.f].path,r.files[+e.dataset.f])});cnt()};
  if($('mdall'))$('mdall').onclick=()=>{$('ml').querySelectorAll('[data-dc]').forEach(e=>{e.checked=true;MB.dsel.set(r.dirs[+e.dataset.dc].path,r.dirs[+e.dataset.dc])});cnt()};
  $('mgo').onclick=async()=>{
    const l=[...MB.sel.values()];
    if(au_){if(!l.length)return toast('pehle file chuno');closeModal();return MB.target==='vis'?setVisAudio(l[0].path):setAudio(l[0].path)}
    let all=l.slice();const rec=$('mrec').checked?1:0;
    for(const d of MB.dsel.values()){const s=await api('/api/scan?path='+encodeURIComponent(d.path)+'&rec='+rec);all=all.concat(s.files)}
    if(!all.length)return toast('pehle file ya folder chuno');
    closeModal();importMedia(all);
  };
}
async function setAudio(path){
  pushUndo();const o0=S.P.audio||{};S.P.audio={path,name:base(path),duration:0,vol:+o0.vol||0,mute:!!o0.mute};renderAudBox();
  const p=await api('/api/probe?p='+encodeURIComponent(path));if(p.duration)S.P.audio.duration=r3(p.duration);
  renderAudBox();loadAudio();changed();
}

/* ================= audio (master clock) + waveform ================= */
function loadAudio(){
  const p=S.P.audio.path;
  if(p===S.audioPath)return;
  S.audioPath=p;S.audioOK=false;S.peaks=null;au.pause();
  if(!p){au.removeAttribute('src');au.load();drawWave();return}
  au.src=fileUrl(p);au.load();
  const tryPeaks=async()=>{const r=await api('/api/peaks?p='+encodeURIComponent(p));if(S.audioPath!==p)return;
    if(r.state==='working')setTimeout(tryPeaks,1200);else if(r.state==='ready'){S.peaks=r;drawWave()}};
  tryPeaks();
}
au.addEventListener('loadedmetadata',()=>{
  S.audioOK=true;if(isFinite(au.duration)){S.P.audio.duration=r3(au.duration);renderAudBox();computeTotal();layout();scheduleSave()}
});
au.addEventListener('error',()=>{S.audioOK=false;toast('Audio browser me nahi chali (preview), render me chalegi')});
function drawWave(){
  const cv=$('wave'),Wd=tl.clientWidth;cv.width=Wd;cv.height=64;const c=cv.getContext('2d');c.clearRect(0,0,Wd,64);
  const ad=audioDur();if(!ad)return;
  const x0=PAD+(0-S.vs)*S.scale,x1=PAD+(ad-S.vs)*S.scale;
  c.fillStyle='#1f3a2a';c.fillRect(Math.max(0,x0),2,Math.min(Wd,x1)-Math.max(0,x0),60);
  const pk=S.peaks;if(!pk||!pk.peaks.length)return;
  c.fillStyle='#4cc26b';
  for(let x=Math.max(0,Math.floor(x0));x<Math.min(Wd,x1);x++){
    const t=S.vs+(x-PAD)/S.scale;let i0=Math.floor(t*pk.pps),i1=Math.max(i0+1,Math.floor((t+1/S.scale)*pk.pps)),m=0;
    for(let i=Math.max(0,i0);i<i1&&i<pk.peaks.length;i++)if(pk.peaks[i]>m)m=pk.peaks[i];
    const h=Math.max(1,m*58);c.fillRect(x,32-h/2,1,h);
  }
}

/* ================= timeline ================= */
const tl=$('tl');
S.cv=$('cv');S.cctx=S.cv.getContext('2d');
function mkClip(c){
  const e=document.createElement('div');e.className='clip '+c.type;e.dataset.id=c.id;
  e.innerHTML='<div class="cth"></div><div class="ctx"><b></b><span class="ix"></span><small class="s1"></small><small class="s2"></small></div><div class="fxs"></div><div class="vxs"></div><i class="hl"></i><i class="hr"></i>';
  e.addEventListener('mousedown',ev=>{
    if(ev.button!==0)return;ev.stopPropagation();
    const mode=ev.target.classList.contains('hl')?'l':ev.target.classList.contains('hr')?'r':'move';
    D={mode,id:c.id,x0:ev.clientX,s0:c.start,d0:c.duration,in0:c.in||0,fx0:JSON.stringify(c.effects||[]),vx0:JSON.stringify(c.vis||[]),moved:false,clickT:timeAtX(ev.clientX)};
    if(S.selA){S.selA=null;markSelA();updateAProps()}
    if(S.sel!==c.id)select(c.id);
  });
  return e;
}
function clipLabel(c){let l;if(c.type!=='image')l='video';else{const n=(c.effects||[]).length;l=n===0?'no fx':n===1?mname(c.effects[0].key):n+' effects'}return l+((c.vis||[]).length?' · 🎧'+c.vis.length:'')}
function refreshClipEl(c){
  const e=S.els[c.id];if(!e)return;
  e.querySelector('b').textContent=clipLabel(c);e.querySelector('.ix').textContent='#'+(S.P.clips.indexOf(c));
  e.querySelector('.s1').textContent=c.name||base(c.resource);e.querySelector('.s2').textContent=c.start.toFixed(2)+' → '+(c.start+c.duration).toFixed(2)+' ('+c.duration.toFixed(2)+'s)';
  const box=e.querySelector('.fxs');box.innerHTML='';
  if(c.type==='image')(c.effects||[]).forEach(f=>{const x=document.createElement('div');x.style.left=(f.start/c.duration*100)+'%';x.style.width=(f.dur/c.duration*100)+'%';x.title=mname(f.key);box.appendChild(x)});
  const vb=e.querySelector('.vxs');vb.innerHTML='';
  (c.vis||[]).forEach(f=>{const x=document.createElement('div');x.style.left=(f.start/c.duration*100)+'%';x.style.width=(f.dur/c.duration*100)+'%';x.title='🎧 '+vname(f.key);vb.appendChild(x)});
}
const fitScale=()=>Math.max(0.01,(tl.clientWidth-2*PAD)/S.total);
const timeAtX=cx=>S.vs+(cx-tl.getBoundingClientRect().left-PAD)/S.scale;
function clampView(){const view=(tl.clientWidth-2*PAD)/S.scale;S.vs=Math.max(0,Math.min(S.vs,S.total-view))}
function fit(){S.vs=0;S.scale=fitScale();layout()}
function zoomBy(f,cx){
  const x=cx===undefined?PAD+(S.time-S.vs)*S.scale:cx-tl.getBoundingClientRect().left;
  const t=S.vs+(x-PAD)/S.scale;S.scale=Math.min(400,Math.max(fitScale(),S.scale*f));S.vs=t-(x-PAD)/S.scale;clampView();layout();
}
function layout(){
  S.scale=Math.max(S.scale,fitScale());clampView();
  const Wd=tl.clientWidth;
  for(const c of S.P.clips){
    const e=S.els[c.id];if(!e)continue;
    const x=PAD+(c.start-S.vs)*S.scale,w=Math.max(c.duration*S.scale-1,3);
    e.style.left=x+'px';e.style.width=w+'px';
    e.classList.toggle('n1',w<46);e.classList.toggle('n2',w>=46&&w<120);e.classList.toggle('sel',c.id===S.sel);
    if(!e._th&&w>=30&&x+w>0&&x<Wd){
      e._th=true;const th=e.querySelector('.cth');th.style.backgroundImage='url("'+thumbUrl(c.resource,((c.in||0)+.3).toFixed(1),240)+'")';
    }
  }
  const r=$('ruler');r.innerHTML='';
  const step=[.1,.2,.5,1,2,5,10,15,30,60,120,300,600,1800,3600].find(v=>v*S.scale>=80)||3600,t1=S.vs+Wd/S.scale;
  for(let t=Math.max(0,Math.floor(S.vs/step)*step);t<=t1;t+=step){
    const k=document.createElement('div');k.className='tick';k.style.left=(PAD+(t-S.vs)*S.scale)+'px';k.textContent=step<1?t.toFixed(1)+'s':fmtS(t);r.appendChild(k);
  }
  const ae=$('aend'),ad=audioDur();ae.style.display=ad?'block':'none';ae.style.left=(PAD+(ad-S.vs)*S.scale)+'px';
  layoutAudio();$('aend').style.height=(tlHeight()-26)+'px';
  drawWave();updatePlayheads();
}
function ensureVisible(t){const view=(tl.clientWidth-2*PAD)/S.scale;if(t<S.vs||t>S.vs+view){S.vs=t-view*.2;clampView();layout()}}
tl.addEventListener('wheel',e=>{
  e.preventDefault();
  if(e.altKey){$('tlscroll').scrollTop+=e.deltaY;return}
  if(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY)){S.vs+=(e.deltaX||e.deltaY)/S.scale;clampView();layout()}
  else zoomBy(e.deltaY<0?1.2:1/1.2,e.clientX);
},{passive:false});
window.addEventListener('resize',()=>{fitStage();layout();renderLane()});

/* free placement (overlap nahi) */
function fitPos(s,dur,id){
  s=Math.max(0,s);const o=S.P.clips.filter(c=>c.id!==id);
  const bad=x=>o.some(c=>x<c.start+c.duration-1e-6&&x+dur>c.start+1e-6);
  if(!bad(s))return s;
  const cand=[0,...o.map(c=>c.start+c.duration),...o.map(c=>c.start-dur)].filter(x=>x>=0&&!bad(x));
  cand.sort((a,b)=>Math.abs(a-s)-Math.abs(b-s));return cand.length?cand[0]:s;
}
function snapT(t,ex){
  if(!S.snap)return null;const th=8/S.scale;let best=null,bd=th;
  const pts=[0,S.time];if(audioDur())pts.push(audioDur());
  for(const c of S.P.clips)if(c.id!==ex)pts.push(c.start,c.start+c.duration);
  for(const p of pts){const d=Math.abs(p-t);if(d<bd){bd=d;best=p}}
  return best;
}
function toggleSnap(){S.snap=!S.snap;$('snapb').classList.toggle('on',S.snap)}

/* timeline mouse: scrub / move / trim */
let D=null;
tl.addEventListener('mousedown',e=>{
  if(e.button===1){D={mode:'pan',x0:e.clientX,vs0:S.vs};e.preventDefault();return}
  if(e.button!==0)return;
  D={mode:'scrub'};seek(timeAtX(e.clientX),true);
});
window.addEventListener('mousemove',e=>{
  if(!D)return;
  if(D.mode==='scrub'){seek(timeAtX(e.clientX),true);ensureVisible(S.time);return}
  if(D.mode==='pan'){S.vs=D.vs0-(e.clientX-D.x0)/S.scale;clampView();layout();return}
  if(D.kind==='a'){dragA(e);return}
  const c=byId(D.id);if(!c)return;
  const dx=e.clientX-D.x0;
  if(!D.moved){if(Math.abs(dx)<3)return;pushUndo();D.moved=true}
  const o=S.P.clips.filter(x=>x.id!==c.id);
  if(D.mode==='move'){
    let t=D.s0+dx/S.scale;const a=snapT(t,c.id),b=snapT(t+c.duration,c.id);
    if(a!==null)t=a;else if(b!==null)t=b-c.duration;
    c.start=r3(fitPos(t,c.duration,c.id));
  }else if(D.mode==='l'){
    const pe=Math.max(0,...o.filter(x=>x.start+x.duration<=D.s0+1e-6).map(x=>x.start+x.duration));
    let lo=pe;if(c.type==='video')lo=Math.max(lo,D.s0-D.in0);
    let s=D.s0+dx/S.scale;const sn=snapT(s,c.id);if(sn!==null)s=sn;
    s=clamp(s,lo,D.s0+D.d0-.2);
    c.start=r3(s);c.duration=r3(D.s0+D.d0-s);
    if(c.type==='video')c.in=r3(D.in0+(s-D.s0));else c.effects=sliceFx(JSON.parse(D.fx0),s-D.s0,D.d0);
    c.vis=sliceFx(JSON.parse(D.vx0),s-D.s0,D.d0);
  }else{
    const ns=Math.min(Infinity,...o.filter(x=>x.start>=D.s0+D.d0-1e-6).map(x=>x.start));
    let hi=ns;if(c.type==='video'&&c.src_duration)hi=Math.min(hi,D.s0+(c.src_duration-D.in0));
    let en=D.s0+D.d0+dx/S.scale;const sn=snapT(en,c.id);if(sn!==null)en=sn;
    en=clamp(en,D.s0+.2,hi);c.duration=r3(en-D.s0);
    if(c.type==='image')c.effects=resizeFx(JSON.parse(D.fx0),D.d0,c.duration);
    c.vis=resizeFx(JSON.parse(D.vx0),D.d0,c.duration);
  }
  normClip(c);refreshClipEl(c);computeTotal();layout();updateProps();
  if(c.id===S.sel)renderLane();
});
window.addEventListener('mouseup',()=>{
  if(!D)return;const d=D;D=null;
  if(d.mode==='scrub'||d.mode==='pan')return;
  if(d.kind==='a'){upA(d);return}
  const c=byId(d.id);if(!c)return;
  if(d.moved)changed();
  else{seek(clamp(d.clickT,c.start,c.start+c.duration-.001),true)}
});

/* drag-drop (library media / effect) on timeline */
function showGhost(e){
  let dur=0;const il=+S.P.settings.image_len||5;
  if(S.dragFolder)dur=S.dragFolder.reduce((a,m)=>a+(m.type==='video'?(m.duration||5):il),0);
  else if(S.dragMedia&&S.dragMedia.type!=='audio')dur=S.dragMedia.type==='video'?(S.dragMedia.duration||5):il;
  else return;
  const g=$('ghost');g.style.display='block';g.style.left=(PAD+(timeAtX(e.clientX)-S.vs)*S.scale)+'px';g.style.width=Math.max(dur*S.scale,6)+'px';
}
tl.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';showGhost(e)});
tl.addEventListener('dragleave',e=>{if(e.target===tl)$('ghost').style.display='none'});
tl.addEventListener('drop',async e=>{
  e.preventDefault();$('ghost').style.display='none';
  const t=timeAtX(e.clientX);
  if(S.dragFolder){const l=S.dragFolder;S.dragFolder=null;await addFolder(l,t)}
  else if(S.dragMedia){const m=S.dragMedia;S.dragMedia=null;
    if(m.type==='audio'){
      const y=e.clientY-tl.getBoundingClientRect().top;
      if(y>=RS-6)await addSfx(m,t,Math.floor((y-RS)/(SH+SG)));
      else if(y>=RA-6&&y<=RA+AH+6){setAudio(m.path);toast('🔊 main audio: '+m.name)}
      else toast('Audio ko A1 (main audio) ya SFX track par girao');
    }else await addMedia(m,t)}
  else if(S.dragVis){const k=S.dragVis;S.dragVis=null;const c=clipAt(t);
    if(c){if(S.sel!==c.id)select(c.id);addVisAt(c.id,k,clamp(t-c.start,0,c.duration),null,null)}else toast('animation ko image / video clip par girao')}
  else if(S.dragKey){const k=S.dragKey;S.dragKey=null;const c=clipAt(t);
    if(c&&c.type==='image'){if(S.sel!==c.id)select(c.id);addAt(c.id,k,clamp(t-c.start,0,c.duration))}else toast('effect sirf image clip par girao')}
});
/* poora folder (library group) timeline par: sab clips ek ke baad ek */
async function addFolder(list,t){
  if(!list.length)return;pushUndo();let pos=Math.max(0,t);
  for(const m of list){const c=await newClip(m);c.start=r3(fitPos(pos,c.duration,c.id));S.P.clips.push(c);pos=c.start+c.duration}
  changed();toast(list.length+' clips jude');
}
/* OS se file/folder drag karne par browser path nahi deta -> import browser khol do */
window.addEventListener('dragover',e=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes('Files'))e.preventDefault()});
window.addEventListener('drop',e=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes('Files')){e.preventDefault();
  toast('Browser OS se folder ka path nahi deta - yahan folder chuno');openBrowser('media')}});
async function newClip(m){
  let dur=+S.P.settings.image_len||5,src=0;
  if(m.type==='video'){
    if(!m.duration){try{const p=await api('/api/probe?p='+encodeURIComponent(m.path));if(p.duration)m.duration=r3(p.duration)}catch(e){}}
    dur=m.duration||5;src=m.duration||0;
  }
  const c={id:uid(),name:m.name||base(m.path),resource:m.path,type:m.type,start:0,end:0,duration:r3(dur),output:''};
  if(m.type==='video')c.src_duration=src;
  normClip(c);return c;
}
function placeClip(c,t){
  t=Math.max(0,t);const o=S.P.clips;
  const inside=o.find(x=>t>x.start-1e-6&&t<x.start+x.duration-1e-6);
  if(!inside){
    const ns=Math.min(Infinity,...o.filter(x=>x.start>=t-1e-6).map(x=>x.start)),gap=ns-t;
    if(gap>=c.duration-1e-6){c.start=r3(t);return}
    if(gap>=.5){c.duration=r3(gap);c.start=r3(t);return}
  }
  c.start=r3(fitPos(t,c.duration,c.id));
}
async function addMedia(m,t){
  pushUndo();const c=await newClip(m);placeClip(c,t);S.P.clips.push(c);
  changed();select(c.id);S.time=c.start;seek(c.start,false);ensureVisible(c.start);
}

/* edit tools */
function select(id){
  if(id===S.sel)return;
  S.tryKey=null;S.fxObj=null;S.sel=id;
  for(const k in S.els)S.els[k].classList.toggle('sel',k===id);
  renderLane();renderList();updateProps();
}
function deleteClip(id,ripple){
  const c=byId(id);if(!c)return toast('pehle clip chuno');
  pushUndo();S.P.clips=S.P.clips.filter(x=>x!==c);
  if(ripple)S.P.clips.forEach(x=>{if(x.start>=c.start+c.duration-1e-6)x.start=r3(x.start-c.duration)});
  S.sel=null;S.fxObj=null;changed();
}
function closeGaps(){pushUndo();let t=0;S.P.clips.sort((a,b)=>a.start-b.start).forEach(c=>{c.start=r3(t);t+=c.duration});changed()}
function splitAtPlayhead(){
  if(S.selA){splitA();return}
  let c=curClip();if(!c||S.time<=c.start||S.time>=c.start+c.duration)c=clipAt(S.time);
  if(!c)return toast('playhead kisi clip par nahi');
  const t=S.time-c.start;if(t<.2||c.duration-t<.2)return toast('split ke liye clip ke andar thoda aage-peeche rakho');
  pushUndo();const old=c.duration,B=JSON.parse(JSON.stringify(c));B.id=uid();
  c.duration=r3(t);B.start=r3(c.start+t);B.duration=r3(old-t);
  if(c.type==='video')B.in=r3((c.in||0)+t);else{B.effects=sliceFx(c.effects,t,old);c.effects=sliceFx(c.effects,0,t)}
  B.vis=sliceFx(c.vis,t,old);c.vis=sliceFx(c.vis,0,t);B.vis.forEach(v=>v.id=uid());
  S.P.clips.push(B);changed();
}
function fillToAudio(){
  const ad=audioDur();if(!ad)return toast('pehle audio chuno');
  const last=S.P.clips.slice().sort((a,b)=>b.start+b.duration-(a.start+a.duration))[0];
  if(!last)return toast('timeline khali hai');
  if(last.type!=='image')return toast('last clip video hai, image ho to hi badhta hai');
  pushUndo();const nd=r3(ad-last.start);if(nd<=last.duration)return toast('already audio tak hai');
  last.effects=resizeFx(last.effects,last.duration,nd);last.vis=resizeFx(last.vis,last.duration,nd);last.duration=nd;changed();
}
function updateProps(){
  updateAProps();const c=curClip();
  $('pt').textContent=c?('#'+S.P.clips.indexOf(c)+' · '+c.type+' · '+(c.name||base(c.resource))):'Clip chuno';
  for(const k of ['ps','pd','pin'])$(k).disabled=!c;
  $('pin').disabled=!c||c.type!=='video';
  if(c){$('ps').value=c.start;$('pd').value=c.duration;$('pin').value=c.in||0}
}
$('ps').onchange=()=>{const c=curClip();if(!c)return;pushUndo();c.start=r3(fitPos(Math.max(0,parseFloat($('ps').value)||0),c.duration,c.id));changed()};
$('pd').onchange=()=>{const c=curClip();if(!c)return;pushUndo();
  const ns=Math.min(Infinity,...S.P.clips.filter(x=>x!==c&&x.start>=c.start+c.duration-1e-6).map(x=>x.start));
  let hi=ns-c.start;if(c.type==='video'&&c.src_duration)hi=Math.min(hi,c.src_duration-(c.in||0));
  const nd=r3(clamp(parseFloat($('pd').value)||c.duration,.2,hi));
  if(c.type==='image')c.effects=resizeFx(c.effects,c.duration,nd);c.vis=resizeFx(c.vis,c.duration,nd);c.duration=nd;changed()};
$('pin').onchange=()=>{const c=curClip();if(!c||c.type!=='video')return;pushUndo();c.in=r3(Math.max(0,parseFloat($('pin').value)||0));changed()};
function updateStat(){const imgs=S.P.clips.filter(d=>d.type==='image');
  $('stat').textContent='Clips: '+S.P.clips.length+' · effects: '+imgs.filter(d=>(d.effects||[]).length).length+'/'+imgs.length+' images'}

/* ================= stage + playback ================= */
function fitStage(){
  const st=$('stage'),r=W/H;let w=st.clientWidth,h=w/r;if(h>st.clientHeight){h=st.clientHeight;w=h*r}
  S.cv.style.width=Math.max(10,w)+'px';S.cv.style.height=Math.max(10,h)+'px';
}
new ResizeObserver(fitStage).observe($('stage'));
const IMGS={};
function getImg(p){let im=IMGS[p];if(!im){im=new Image();im.onerror=()=>{im._bad=1};im.src=fileUrl(p);IMGS[p]=im}return im}
function ensureVid(){
  if(S.vid)return S.vid;const v=document.createElement('video');v.muted=false;v.playsInline=true;v.preload='auto';
  v.addEventListener('error',async()=>{
    if(!v.getAttribute('src')||S.vtried)return;S.vtried=true;
    const c=byId(S.vclip);if(!c)return;let ok=false;try{ok=(await api('/api/proxy?p='+encodeURIComponent(c.resource))).ok}catch(e){}
    if(ok){v.src='/proxy?p='+encodeURIComponent(c.resource);v.load()}else showErr('Video browser me nahi chali, ffmpeg proxy fail')
  });
  S.vid=v;return v;
}
function showErr(m){const e=$('err');e.textContent=m;e.style.display=m?'block':'none'}
function drawStage(){
  const c=S.cctx;c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';
  const clip=clipAt(S.time);
  if(!clip){c.fillStyle='#000';c.fillRect(0,0,W,H);if(S.vid&&!S.vid.paused)S.vid.pause();S.vclip=null;return}
  if(clip.type==='image'){
    if(S.vid&&!S.vid.paused)S.vid.pause();S.vclip=null;
    const im=getImg(clip.resource);showErr(im._bad?'Image file nahi mili: '+clip.resource:'');
    drawSeg(c,im,clip,S.time-clip.start,fxList(clip,clip.id===S.sel));drawVis(c,clip,S.time-clip.start);return;
  }
  const v=ensureVid();
  if(S.vclip!==clip.id){S.vclip=clip.id;S.vtried=false;showErr('');v.src=fileUrl(clip.resource);v.load()}
  const want=(clip.in||0)+(S.time-clip.start);
  setGain(v,(S.P.vtrack.mute||clip.amute)?0:dbLin((+clip.vol_db||0)+(+S.P.vtrack.vol||0)));
  if(v.readyState>=1){
    if(Math.abs(v.currentTime-want)>(S.playing?.3:.04)&&!v.seeking){try{v.currentTime=want}catch(e){}}
    if(S.playing&&v.paused)v.play().catch(()=>{});
    if(!S.playing&&!v.paused)v.pause();
  }
  c.fillStyle='#000';c.fillRect(0,0,W,H);
  if(v.readyState>=2&&v.videoWidth){
    const s=Math.max(W/v.videoWidth,H/v.videoHeight);c.drawImage(v,(W-v.videoWidth*s)/2,(H-v.videoHeight*s)/2,v.videoWidth*s,v.videoHeight*s);
  }
  drawVis(c,clip,S.time-clip.start);
}
function setPlaying(v){
  if(v&&S.time>=S.total-.05)S.time=0;
  S.playing=!!v;$('pp').textContent=v?'⏸ Pause':'▶ Play';$('fspp').textContent=v?'⏸':'▶';
  if(v)ensureAC();
  if(v){if(S.audioOK&&S.time<au.duration-.05){try{au.currentTime=S.time}catch(e){}au.play().catch(()=>{})}}
  else{au.pause();if(S.vid)S.vid.pause()}
}
function togglePlay(){if(!S.P.clips.length&&!audioDur())return;setPlaying(!S.playing)}
function tick(dt){
  const ad=S.audioOK?au.duration:0;
  if(S.audioOK&&S.time<ad-.03){
    if(au.paused&&!au.ended){try{if(Math.abs(au.currentTime-S.time)>.1)au.currentTime=S.time}catch(e){}au.play().catch(()=>{});S.time+=dt}
    else if(!au.seeking)S.time=au.currentTime;
  }else{if(!au.paused)au.pause();S.time+=dt}
  if(S.time>=S.total){S.time=S.total-.001;setPlaying(false)}
  const c=clipAt(S.time);if(c&&c.id!==S.sel)select(c.id);
  updatePlayheads();
}
function seek(t,user){
  S.time=clamp(t,0,S.total-.001);
  if(S.playing&&S.audioOK){try{au.currentTime=S.time}catch(e){}}
  const c=clipAt(S.time);if(c&&c.id!==S.sel)select(c.id);
  const d=curClip();
  if(user&&S.tryKey&&d&&d.type==='image')S.tryStart=q05(clamp(S.time-d.start,0,Math.max(0,d.duration-.3)));
  updatePlayheads();
}
function updatePlayheads(){
  const view=(tl.clientWidth-2*PAD)/S.scale;
  if(S.playing&&(S.time>S.vs+view||S.time<S.vs)){S.vs=Math.max(0,S.time-view*.1);clampView();layout();return}
  $('ph').style.left=(PAD+(S.time-S.vs)*S.scale-1)+'px';
  const d=curClip(),loc=d?clamp(S.time-d.start,0,d.duration):0;
  $('tt').textContent=fmt(S.time)+' / '+fmtS(S.total)+(d?'  ·  local '+loc.toFixed(1)+'s':'');
  const lp=$('lph');if(lp&&d&&(d.type==='image'||isVis()))lp.style.left=(loc/d.duration*$('track').clientWidth-1)+'px';
}
let lastInfo=0;
function updateInfo(){
  const el=$('info'),t=S.time,c=clipAt(t);
  if(!c){el.innerHTML=S.P.clips.length?'(gap - khali / black)':'Library se image/video timeline me drag karo';return}
  let m='';
  if(c.type==='image'){const T=clamp(t-c.start,0,c.duration),act=fxList(c,c.id===S.sel).filter(e=>T>=e.start&&T<=e.start+e.dur).map(e=>mname(e.key)+(e.tmp?' (preview)':''));
    m=' &nbsp;│&nbsp; abhi: <b style="color:#e3b3ff">'+(act.length?act.join(' + '):'plain image')+'</b>'}
  const Tl=t-c.start,av=(c.vis||[]).filter(v=>Tl>=v.start&&Tl<v.start+v.dur).map(v=>vname(v.key));
  el.innerHTML='#'+S.P.clips.indexOf(c)+' · '+c.type+' · '+esc(base(c.resource))+m+(av.length?' &nbsp;│&nbsp; 🎧 <b style="color:#7ee787">'+av.join(' + ')+'</b>':'');
}
let last=performance.now();
function loop(now){
  const dt=Math.min(.1,(now-last)/1000);last=now;
  if(S.playing)tick(dt);
  drawStage();syncAudio();updateVisHandle();fsbarUpdate();
  if(now-lastInfo>150){lastInfo=now;updateInfo()}
  requestAnimationFrame(loop);
}
window.addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&e.code!=='Escape')return;
  if($('lightbox').classList.contains('on')){if(e.code==='Escape')closeLightbox();return}
  if($('modal').classList.contains('on')){if(e.code==='Escape')closeModal();return}
  const k=e.key.toLowerCase();
  if(e.code==='Space'){e.preventDefault();togglePlay()}
  else if((e.ctrlKey||e.metaKey)&&k==='s'){e.preventDefault();saveNow()}
  else if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();e.shiftKey?redo():undo()}
  else if((e.ctrlKey||e.metaKey)&&k==='y'){e.preventDefault();redo()}
  else if((e.ctrlKey||e.metaKey)&&k==='c'){e.preventDefault();copySel()}
  else if((e.ctrlKey||e.metaKey)&&k==='v'){e.preventDefault();pasteClip()}
  else if((e.ctrlKey||e.metaKey)&&k==='d'){e.preventDefault();duplicateSel()}
  else if(k==='f'&&!e.ctrlKey)fit();
  else if(k==='s'&&!e.ctrlKey)splitAtPlayhead();
  else if(k==='m'&&!e.ctrlKey)toggleMax();
  else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();if(S.fxObj)removeFx(S.fxObj);else if(S.selA)deleteA(S.selA);else deleteClip(S.sel,e.shiftKey)}
  else if(e.key==='ArrowRight'){seek(S.time+(e.shiftKey?1:1/FPS),true);ensureVisible(S.time)}
  else if(e.key==='ArrowLeft'){seek(S.time-(e.shiftKey?1:1/FPS),true);ensureVisible(S.time)}
  else if(e.key==='ArrowUp'||e.key==='ArrowDown'){
    const pts=[...new Set(S.P.clips.flatMap(c=>[c.start,c.start+c.duration]))].sort((a,b)=>a-b);
    const t=e.key==='ArrowUp'?pts.filter(p=>p<S.time-.01).pop():pts.find(p=>p>S.time+.01);if(t!==undefined){seek(t,true);ensureVisible(t)}
  }
  else if(e.key==='Home')seek(0,true);else if(e.key==='End')seek(S.total,true);
  else if(e.key==='Escape'){S.tryKey=null;renderLane();renderList()}
});

/* ================= LANE: FX (image effects) / VIS (audio animations) ================= */
const track=$('track');
const isVis=()=>S.tab==='vis';
const laneList=d=>isVis()?(d.vis||(d.vis=[])):(d.effects||(d.effects=[]));
const laneOK=d=>!!d&&(isVis()||d.type==='image');
const lname=k=>isVis()?vname(k):mname(k);
function removeFx(e){const d=curClip();if(!d)return;pushUndo();const L=laneList(d),i=L.indexOf(e);if(i>=0)L.splice(i,1);if(S.fxObj===e)S.fxObj=null;commitFx(d)}
function commitFx(d){
  laneList(d).sort((a,b)=>a.start-b.start);normClip(d);refreshClipEl(d);renderLane();renderList();updateStat();updateProps();scheduleSave();
}
function addAt(id,key,loc){
  const d=byId(id);if(!d||d.type!=='image'||!key)return;
  if(S.sel!==id){S.time=d.start+loc;select(id)}
  pushUndo();
  const ne=addFxData(d,key,loc,parseFloat($('deflen').value)||0);
  S.fxObj=ne;S.tryKey=null;S.time=d.start+ne.start;
  commitFx(d);setPlaying(true);toast(mname(key)+' → '+ne.start.toFixed(2)+'s se '+(ne.start+ne.dur).toFixed(2)+'s');
}
/* audio animation: image ya video clip par, (x,y) = anchor position (project pixels) */
function addVisAt(id,key,loc,x,y){
  const d=byId(id),an=VANIM(key);if(!d||!an)return;
  if(S.tab!=='vis')setTab('vis');
  if(S.sel!==id){S.time=d.start+loc;select(id)}
  pushUndo();
  const s=q05(clamp(loc,0,Math.max(0,d.duration-.3)));
  let dur=d.duration-s;const dl=parseFloat($('deflen').value)||0;if(dl>0)dur=Math.min(dur,dl);
  const df=an.defaults||{};
  const it={id:uid(),key,start:+s.toFixed(2),dur:+Math.max(.3,dur).toFixed(2),
    x:Math.round(x!=null?x:(df.x!=null?df.x:W/2)),y:Math.round(y!=null?y:(df.y!=null?df.y:H/2)),scale:df.scale||1};
  (d.vis||(d.vis=[])).push(it);S.fxObj=it;S.time=d.start+it.start;
  commitFx(d);setPlaying(true);toast('🎧 '+an.name+' → '+it.start.toFixed(2)+'s se, position '+it.x+','+it.y);
}
function applyPick(){
  const d=curClip();
  if(isVis()){
    if(!d)return toast('pehle timeline se clip chuno');
    if(!S.pickV)return toast('pehle list se animation chuno');
    return addVisAt(S.sel,S.pickV,clamp(S.time-d.start,0,d.duration),null,null);
  }
  if(!d||d.type!=='image')return toast('pehle timeline se image chuno');
  if(S.tryKey)return addAt(S.sel,S.tryKey,S.tryStart);
  if(!S.pick)return toast('pehle list se effect chuno');
  addAt(S.sel,S.pick,clamp(S.time-d.start,0,d.duration));
}
function fillVisInputs(){const e=S.fxObj;if(!e||!isVis())return;$('vs_s').value=e.start;$('vs_d').value=e.dur;$('vs_x').value=e.x;$('vs_y').value=e.y;$('vs_k').value=e.scale||1}
function renderLane(){
  const d=curClip(),lane=$('lane'),vis=isVis();track.innerHTML='';
  $('lh').style.display=vis?'none':'flex';$('lhv').style.display=vis?'flex':'none';
  const lp=document.createElement('div');lp.id='lph';
  if(!laneOK(d)){
    $(vis?'ltv':'lt').textContent=d?'Video clip — image effects nahi lagte (🎧 Audio animations tab me animation laga sakte ho)':'Timeline se '+(vis?'image / video':'image')+' clip chuno';
    lane.classList.add('off');$('fxp').classList.remove('on');$('vxp').classList.remove('on');track.appendChild(lp);return;
  }
  lane.classList.remove('off');
  const dur=d.duration,Wd=track.clientWidth||600,k=Wd/dur,L=laneList(d);
  $(vis?'ltv':'lt').textContent=`${vis?'🎧 Animation lane':'FX lane'} · #${S.P.clips.indexOf(d)} · ${base(d.resource)} · ${dur}s · ${L.length} ${vis?'animation':'effect'}`;
  const step=[.5,1,2,5,10,15,30,60,120,300].find(v=>v*k>=70)||300;
  for(let t=0;t<=dur+.001;t+=step){const x=document.createElement('div');x.className='lt';x.style.left=(t*k)+'px';x.textContent=t+'s';track.appendChild(x)}
  const rowEnd=[0,0];
  const put=(e,tmp)=>{
    let r=rowEnd[0]<=e.start+.001?0:rowEnd[1]<=e.start+.001?1:(e.start%2<1?0:1);rowEnd[r]=e.start+e.dur;
    const b=document.createElement('div');b.className='fxb'+(e===S.fxObj?' sel':'')+(tmp?' tmp':'');
    b.style.left=(e.start*k)+'px';b.style.width=Math.max(e.dur*k,8)+'px';b.style.top=(22+r*28)+'px';
    b.style.background=`hsl(${hue(e.key)},50%,34%)`;b._e=e;
    b.title=`${lname(e.key)}  ${e.start}s → ${(e.start+e.dur).toFixed(2)}s`+(vis?`  · pos ${e.x},${e.y}`:'');
    b.innerHTML=(tmp?'':'<i class="hl"></i>')+'<span>'+(vis?'🎧 ':'')+lname(e.key)+(tmp?' (preview)':'')+'</span>'+(tmp?'':'<i class="hr"></i>');
    track.appendChild(b);
  };
  L.forEach(e=>put(e,false));
  if(!vis&&S.tryKey)put({key:S.tryKey,start:S.tryStart,dur:Math.max(.3,dur-S.tryStart)},true);
  track.appendChild(lp);
  const e=S.fxObj;
  $('fxp').classList.toggle('on',!vis&&!!e);$('vxp').classList.toggle('on',vis&&!!e);
  if(e){if(vis)fillVisInputs();else{$('fs').value=e.start;$('fd').value=e.dur}}
  updatePlayheads();
}
let fdrag=null;
track.addEventListener('mousedown',ev=>{
  const d=curClip();if(!laneOK(d))return;
  const dur=d.duration,k=track.clientWidth/dur,rect=track.getBoundingClientRect(),b=ev.target.closest('.fxb');
  if(!b||b.classList.contains('tmp')){S.fxObj=null;fdrag={seek:true};seek(d.start+clamp((ev.clientX-rect.left)/k,0,dur),true);renderLane();return}
  const e=b._e;S.fxObj=e;pushUndo();
  fdrag={e,mode:ev.target.classList.contains('hl')?'l':ev.target.classList.contains('hr')?'r':'m',x0:ev.clientX,s0:e.start,d0:e.dur,k,dur,moved:false};
  ev.preventDefault();renderLane();
});
window.addEventListener('mousemove',ev=>{
  if(!fdrag)return;
  const d=curClip();if(!d)return;
  if(fdrag.seek){const rect=track.getBoundingClientRect(),k=track.clientWidth/d.duration;seek(d.start+clamp((ev.clientX-rect.left)/k,0,d.duration),true);return}
  const f=fdrag,e=f.e,dx=q05((ev.clientX-f.x0)/f.k);if(dx!==0)f.moved=true;
  if(f.mode==='m')e.start=+clamp(f.s0+dx,0,f.dur-e.dur).toFixed(2);
  else if(f.mode==='l'){const s=clamp(f.s0+dx,0,f.s0+f.d0-.2);e.start=+s.toFixed(2);e.dur=+(f.d0-(s-f.s0)).toFixed(2)}
  else e.dur=+clamp(f.d0+dx,.2,f.dur-e.start).toFixed(2);
  renderLane();refreshClipEl(d);
});
window.addEventListener('mouseup',()=>{
  if(!fdrag)return;const f=fdrag;fdrag=null;
  if(f.e){if(f.moved)commitFx(curClip());else{S.hist.pop();renderLane()}}
});
track.addEventListener('dblclick',ev=>{
  const d=curClip();if(!laneOK(d)||ev.target.closest('.fxb'))return;
  const k=isVis()?S.pickV:S.pick;
  if(!k)return toast(isVis()?'pehle list se animation chuno':'pehle list se effect chuno');
  const rect=track.getBoundingClientRect(),loc=clamp((ev.clientX-rect.left)/(track.clientWidth/d.duration),0,d.duration);
  if(isVis())addVisAt(S.sel,k,loc,null,null);else addAt(S.sel,k,loc);
});
track.addEventListener('dragover',e=>{e.preventDefault()});
track.addEventListener('drop',e=>{
  e.preventDefault();const d=curClip();
  const kv=S.dragVis,kf=S.dragKey;S.dragVis=null;S.dragKey=null;
  if(!d)return;
  const rect=track.getBoundingClientRect(),loc=clamp((e.clientX-rect.left)/(track.clientWidth/d.duration),0,d.duration);
  if(kv&&isVis())addVisAt(d.id,kv,loc,null,null);
  else if(kf&&!isVis()&&d.type==='image')addAt(d.id,kf,loc);
});
$('fs').onchange=()=>{const e=S.fxObj,d=curClip();if(!e)return;pushUndo();e.start=+clamp(parseFloat($('fs').value)||0,0,d.duration-.2).toFixed(2);e.dur=+Math.min(e.dur,d.duration-e.start).toFixed(2);commitFx(d)};
$('fd').onchange=()=>{const e=S.fxObj,d=curClip();if(!e)return;pushUndo();e.dur=+clamp(parseFloat($('fd').value)||.2,.1,d.duration-e.start).toFixed(2);commitFx(d)};
$('fdel').onclick=()=>S.fxObj&&removeFx(S.fxObj);
const vinp=(id,fn)=>{$(id).onchange=()=>{const e=S.fxObj,d=curClip();if(!e||!d||!isVis())return;pushUndo();fn(e,d,parseFloat($(id).value));commitFx(d)}};
vinp('vs_s',(e,d,v)=>{e.start=+clamp(v||0,0,d.duration-.2).toFixed(2);e.dur=+Math.min(e.dur,d.duration-e.start).toFixed(2)});
vinp('vs_d',(e,d,v)=>{e.dur=+clamp(v||.2,.1,d.duration-e.start).toFixed(2)});
vinp('vs_x',(e,d,v)=>{e.x=Math.round(isNaN(v)?e.x:v)});
vinp('vs_y',(e,d,v)=>{e.y=Math.round(isNaN(v)?e.y:v)});
vinp('vs_k',(e,d,v)=>{e.scale=+clamp(v||1,.1,6).toFixed(2)});
$('vdel').onclick=()=>S.fxObj&&removeFx(S.fxObj);
$('fade').oninput=()=>{S.fade=Math.max(0,parseFloat($('fade').value)||0);S.P.settings.fade=S.fade;scheduleSave()};

/* ================= right: image effects / audio animations ================= */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/* order: chhota number upar (1, 2, 3...); order nahi to end me, load order me */
const byOrder=arr=>arr.map((x,i)=>[x,i]).sort((a,b)=>((a[0].order!=null?a[0].order:1e9)-(b[0].order!=null?b[0].order:1e9))||(a[1]-b[1])).map(x=>x[0]);
const VANIM=k=>(window.AUDIO_ANIMS||[]).find(a=>a.key===k);
const vname=k=>{const a=VANIM(k);return a?a.name:k+' (?)'};
let VRT={};
/* animation instance: (clip, item) ke hisaab se; config / audio badle to naya banta hai */
function visInstance(c,it){
  const an=VANIM(it.key);if(!an)return null;
  const absT=c.start+it.start,sig=[it.key,absT.toFixed(3),it.dur.toFixed(3),S.visSig].join('|'),k=c.id+':'+it.id;
  let r=VRT[k];
  if(!r||r.sig!==sig){r={sig,inst:an.create({audio:S.visData,t0:absT,dur:it.dur})};VRT[k]=r}
  return r.inst;
}
/* clip ke upar (additive) saari audio animations; T = clip ke start se seconds */
function drawVis(ctx,c,T){
  const list=c.vis;if(!list||!list.length)return;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='lighter';
  for(const it of list){
    const t=T-it.start;if(t<0||t>=it.dur)continue;
    try{const inst=visInstance(c,it);if(inst)inst.render(ctx,t,it.x,it.y,it.scale||1)}
    catch(err){if(!warned.has(it)){warned.add(it);console.error('Audio animation '+it.key,err)}}
  }
  ctx.restore();
}
function renderVisBox(){
  const a=S.P.vis_audio,b=$('visinfo');
  let h=a&&a.path?`🎙 <b style="color:#7ee787">${esc(a.name||base(a.path))}</b><span class="vpth" title="${esc(a.path)}">${esc(a.path)}</span>`
    :'🎙 Analysis audio nahi chuni <span class="vpth">(raw voice, SFX ke bina)</span>';
  if(S.numpy===false)h+='<span style="color:#ff9a9a">⚠ numpy install nahi hai: pip install numpy</span><br>';
  h+=S.visStat||'';b.innerHTML=h;
}
function setVisAudio(path){
  pushUndo();S.P.vis_audio={path,name:base(path),duration:0};S.visData=null;S.visSig='none';VRT={};S.visStat='';
  renderVisBox();scheduleSave();ensureVis();
}
/* audio_data.npz tayar karwao (server) aur data browser me load karo */
async function ensureVis(){
  const a=S.P.vis_audio;
  if(!a||!a.path){S.visData=null;S.visSig='none';S.visStat='';renderVisBox();return}
  if(S.visBusy===a.path)return;
  if(S.visData&&S.visData.path===a.path)return;
  S.visBusy=a.path;S.visStat='⏳ check kar rahe hain...';renderVisBox();
  try{
    const r=await api('/api/vis_ensure',{path:a.path});
    if(!r.ok)throw new Error(r.error||'fail');
    for(;;){
      const s=await api('/api/vis_status');
      if(!S.P.vis_audio||S.P.vis_audio.path!==a.path)return;
      if(s.state==='working'){S.visStat='⏳ audio analysis '+s.pct+'% (audio_data.npz ban rahi hai)';renderVisBox();await sleep(700);continue}
      if(s.state==='error')throw new Error(s.msg);
      break;
    }
    const d=await api('/api/vis_data');
    if(d.error)throw new Error(d.error);
    S.visData=d;S.visSig=d.path+'|'+d.audioMtime+'|'+d.total;VRT={};
    S.visStat='✓ data taiyar · '+d.total+' blocks · '+d.pps.toFixed(1)+'/s · audio_data.npz';
  }catch(err){S.visStat='⚠ '+err.message;S.visData=null;S.visSig='none'}
  finally{S.visBusy='';renderVisBox()}
}
function setTab(t){
  S.tab=t;S.fxObj=null;S.tryKey=null;$('side').classList.toggle('vis',t==='vis');
  $('rtabs').querySelectorAll('span').forEach(x=>x.classList.toggle('on',x.dataset.t===t));
  $('visbox').style.display=t==='vis'?'block':'none';
  $('q').placeholder=t==='vis'?'Animation search':'Motion search (naam / key / tag)';
  $('apply').textContent=t==='vis'?'🎧 Animation lagao (playhead se)':'Effect lagao';
  $('dt').innerHTML=t==='vis'?'Animation ko <b>clip</b> ya <b>stage</b> par drag karo (stage drop = position). ✛ handle se position badlo.':'Effect par click = playhead se preview (play hota hai)';
  renderLane();renderList();
}
$('rtabs').onclick=e=>{if(e.target.dataset.t)setTab(e.target.dataset.t)};
function renderList(){
  const q=$('q').value.toLowerCase(),d=curClip(),box=$('list'),top=box.scrollTop;box.innerHTML='';
  if(isVis()){
    const used=new Set(d?(d.vis||[]).map(v=>v.key):[]);
    byOrder(window.AUDIO_ANIMS||[]).filter(a=>(a.key+' '+a.name+' '+(a.tag||'')).toLowerCase().includes(q)).forEach(a=>{
      const r=document.createElement('div');r.className='row'+(used.has(a.key)?' cur':'')+(a.key===S.pickV?' pick':'');
      r.draggable=true;r.innerHTML=`<b><i>${a.order!=null?'#'+a.order+' · ':''}${esc(a.key)}</i>${esc(a.name)}</b><span>${esc(a.tag||'')}</span>`;
      r.ondragstart=e=>{e.dataTransfer.setData('text/plain',a.key);e.dataTransfer.effectAllowed='copy';S.dragVis=a.key;S.dragKey=null;S.dragMedia=null;S.dragFolder=null};
      r.ondragend=()=>{S.dragVis=null};
      r.onclick=()=>{S.pickV=a.key;renderList()};
      r.ondblclick=()=>{const dd=curClip();if(!dd)return toast('pehle timeline se clip chuno');addVisAt(S.sel,a.key,clamp(S.time-dd.start,0,dd.duration),null,null)};
      box.appendChild(r);
    });
    if(!box.children.length)box.innerHTML='<div style="color:#6d778c;padding:10px">audio_animations.js nahi mili ya khali hai</div>';
    box.scrollTop=top;return;
  }
  const used=new Set(d&&d.type==='image'?(d.effects||[]).map(e=>e.key):[]);
  byOrder(MOTIONS).filter(m=>(m.key+' '+m.name+' '+(m.tag||'')).toLowerCase().includes(q)).forEach(m=>{
    const r=document.createElement('div');
    r.className='row'+(used.has(m.key)?' cur':'')+(m.key===S.pick?' pick':'');
    r.draggable=true;
    r.innerHTML=`<b><i>${m.order!=null?'#'+m.order+' · ':''}${esc(m.key)}</i>${esc(m.name)}</b><span>${esc(m.tag||'')}</span>`;
    r.ondragstart=e=>{e.dataTransfer.setData('text/plain',m.key);e.dataTransfer.effectAllowed='copy';S.dragKey=m.key;S.dragMedia=null;S.dragVis=null;S.dragFolder=null};
    r.ondragend=()=>{S.dragKey=null};
    r.onclick=()=>pickMotion(m.key);
    r.ondblclick=()=>{const dd=curClip();if(!dd||dd.type!=='image')return toast('pehle timeline se image chuno');addAt(S.sel,m.key,clamp(S.time-dd.start,0,dd.duration))};
    box.appendChild(r);
  });
  box.scrollTop=top;
}
function pickMotion(key){
  S.pick=key;const d=curClip();
  if(!d||d.type!=='image'){$('dt').textContent='Pehle timeline se image clip chuno';renderList();return}
  S.tryKey=key;S.tryStart=q05(clamp(S.time-d.start,0,Math.max(0,d.duration-.3)));
  $('dt').innerHTML='Preview: <b style="color:#e3b3ff">'+mname(key)+'</b> · '+S.tryStart.toFixed(2)+'s se · save = niche button / double-click';
  $('apply').textContent='✓ "'+mname(key)+'" '+S.tryStart.toFixed(2)+'s se save karo';
  S.time=d.start+S.tryStart;setPlaying(true);renderLane();renderList();
}
/* stage: effect drop = playhead se, audio animation drop = drop ki jagah position */
$('stage').ondragover=e=>{e.preventDefault();$('stage').classList.add('over')};
$('stage').ondragleave=()=>$('stage').classList.remove('over');
$('stage').ondrop=e=>{
  e.preventDefault();$('stage').classList.remove('over');
  if(S.dragVis){
    const k=S.dragVis;S.dragVis=null;
    const c=clipAt(S.time)||curClip();
    if(!c)return toast('pehle timeline me image / video clip lagao');
    const r=S.cv.getBoundingClientRect();
    const x=clamp((e.clientX-r.left)/r.width*W,0,W),y=clamp((e.clientY-r.top)/r.height*H,0,H);
    if(S.sel!==c.id)select(c.id);
    addVisAt(c.id,k,clamp(S.time-c.start,0,c.duration),x,y);return;
  }
  const k=S.dragKey;S.dragKey=null;const d=curClip();
  if(d&&d.type==='image'&&k)addAt(S.sel,k,clamp(S.time-d.start,0,d.duration));
};
$('q').oninput=renderList;
/* stage par ✛ handle: selected animation ki position drag karke badlo */
const vh=$('vh');let vd=null;
function updateVisHandle(){
  const c=clipAt(S.time),it=S.fxObj;
  const show=isVis()&&c&&it&&c.id===S.sel&&(c.vis||[]).includes(it)&&S.time>=c.start+it.start-.001&&S.time<=c.start+it.start+it.dur;
  if(!show){vh.style.display='none';return}
  const r=S.cv.getBoundingClientRect(),st=$('stage').getBoundingClientRect();
  vh.style.display='block';vh.style.left=(r.left-st.left+it.x/W*r.width)+'px';vh.style.top=(r.top-st.top+it.y/H*r.height)+'px';
}
vh.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();if(!S.fxObj)return;pushUndo();vd={it:S.fxObj,moved:false}});
window.addEventListener('mousemove',e=>{
  if(!vd)return;const r=S.cv.getBoundingClientRect();
  vd.it.x=Math.round(clamp((e.clientX-r.left)/r.width*W,0,W));vd.it.y=Math.round(clamp((e.clientY-r.top)/r.height*H,0,H));vd.moved=true;fillVisInputs();
});
window.addEventListener('mouseup',()=>{
  if(!vd)return;const m=vd.moved;vd=null;
  if(m){const c=curClip();if(c)commitFx(c)}else S.hist.pop();
});

/* ================= render ================= */
const R={busy:false,cancel:false};
function h32(s,seed){let h=seed||2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16)}
function clipKey(c){
  const s=JSON.stringify([c.resource,c.duration,c.effects,S.fade,W,H,FPS,(c.effects||[]).map(e=>mot(e.key)?mot(e.key).draw.toString():'')]);
  return h32(s)+h32(s,12345);
}
function visKey(c){
  const sig=(c.vis||[]).map(v=>{const a=VANIM(v.key);return a?h32(a.cls.toString()):'?'});
  const s=JSON.stringify([c.start,c.duration,c.vis,S.visSig,W,H,FPS,sig]);
  return h32(s)+h32(s,12345);
}
/* mode: 'fx' = image + effects | 'full' = image + effects + audio animation | 'vis' = sirf animation (kaale background par) */
async function renderClipFrames(c,rel,label,setBtn,mode){
  mode=mode||'fx';
  const dur=c.duration,N=Math.max(1,Math.round(dur*FPS)),list=fxList(c,false);
  let img=null;
  if(mode!=='vis'){
    img=getImg(c.resource);if(!img.complete)await new Promise(r=>{img.onload=r;img.onerror=r});
    if(!img.naturalWidth)throw new Error('image file nahi mili: '+c.resource);
  }
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const ctx=cv.getContext('2d');
  const r=await api('/api/render_start',{out:rel,fps:FPS});if(!r.ok)throw new Error(r.error||'render start fail');
  const job=r.job;
  try{
    for(let k=0;k<N;k++){
      if(R.cancel)throw new Error('cancelled');
      const T=k/FPS;
      if(mode==='vis'){ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);drawVis(ctx,c,T)}
      else{drawSeg(ctx,img,c,T,list);if(mode==='full')drawVis(ctx,c,T)}
      const blob=await new Promise(res=>cv.toBlob(res,'image/jpeg',.95));
      const rr=await fetch('/api/render_frame?job='+job,{method:'POST',body:blob});
      if(!rr.ok)throw new Error((await rr.json()).error||'frame send fail');
      if(k%10===0){setBtn(label+' '+Math.round(k/N*100)+'%');await new Promise(r=>setTimeout(r))}
    }
    const e=await api('/api/render_end',{job});if(!e.ok)throw new Error(e.error);return e.file;
  }catch(err){fetch('/api/render_cancel',{method:'POST',body:JSON.stringify({job})});throw err}
}
async function renderSelected(){
  if(R.busy)return;
  const c=curClip();
  if(!c)return toast('pehle timeline se image ya video clip chuno');
  if(S.tryKey&&c.type==='image')addAt(c.id,S.tryKey,S.tryStart);
  const hasFx=c.type==='image'&&(c.effects||[]).length,hasVis=(c.vis||[]).length;
  if(c.type==='image'&&!hasFx&&!hasVis)return toast('image par pehle effect ya audio animation lagao');
  R.busy=true;R.cancel=false;setPlaying(false);const b=$('rbtn2'),old=b.textContent;
  try{
    if(hasVis){await ensureVis();while(S.visBusy)await sleep(300);if(!S.visData)throw new Error('Analysis audio ka data taiyar nahi (🎧 Audio animations tab)')}
    if(c.type==='image'){
      const f=await renderClipFrames(c,c.output+'.mp4','⏳',t=>b.textContent=t,'full');
      toast('✓ Saved: '+f);
    }else{                                   // video: ffmpeg se cut + (animation ho to) overlay blend, video ki awaaz ke saath
      let vpart='';
      if(hasVis){
        const rel='_cache/v_'+visKey(c)+'.mp4';let have=[];
        if($('cache').checked)have=(await api('/api/exists',{files:['motion/'+rel]})).have;
        vpart=have.length?'motion/'+rel:await renderClipFrames(c,rel,'⏳ 🎧',t=>b.textContent=t,'vis');
      }
      b.textContent='⏳ video ban rahi hai...';
      const r=await api('/api/render_clip',{project:S.P,id:c.id,vpart});if(!r.ok)throw new Error(r.error||'start fail');
      for(;;){
        await sleep(700);const s=await api('/api/clip_status');
        if(s.state==='done'){toast('✓ Saved: '+s.file);break}
        if(s.state==='error')throw new Error(s.msg);
      }
    }
  }catch(err){console.error(err);toast('Render error: '+err.message)}
  R.busy=false;b.textContent=old;
}
async function renderFull(){
  const b=$('rbtn'),old='🎬 Full video render';
  if(R.busy){R.cancel=true;api('/api/final_cancel',{});return}
  if(!S.P.clips.length)return toast('timeline khali hai');
  await saveNow();R.busy=true;R.cancel=false;setPlaying(false);b.textContent='⛔ Cancel';
  try{
    const imgs=S.P.clips.filter(c=>c.type==='image'&&(c.effects||[]).length);
    const vcl=S.P.clips.filter(c=>(c.vis||[]).length);
    if(vcl.length){await ensureVis();while(S.visBusy)await sleep(300);if(!S.visData)throw new Error('Audio animation ke liye "Analysis audio" chuno (🎧 tab) aur analysis poora hone do')}
    const rels={},vrels={};
    imgs.forEach(c=>rels[c.id]='_cache/'+clipKey(c)+'.mp4');
    vcl.forEach(c=>vrels[c.id]='_cache/v_'+visKey(c)+'.mp4');
    let have=[];
    if($('cache').checked)have=(await api('/api/exists',{files:[...Object.values(rels),...Object.values(vrels)].map(x=>'motion/'+x)})).have;
    const parts={},vparts={};let i=0;const tot=imgs.length+vcl.length;
    for(const c of imgs){
      i++;const rel=rels[c.id];
      if(have.includes('motion/'+rel)){parts[c.id]='motion/'+rel;continue}
      parts[c.id]=await renderClipFrames(c,rel,'⏳ '+i+'/'+tot,t=>$('rbtn').textContent='⛔ '+t,'fx');
    }
    for(const c of vcl){
      i++;const rel=vrels[c.id];
      if(have.includes('motion/'+rel)){vparts[c.id]='motion/'+rel;continue}
      vparts[c.id]=await renderClipFrames(c,rel,'⏳ '+i+'/'+tot+' 🎧',t=>$('rbtn').textContent='⛔ '+t,'vis');
    }
    const r=await api('/api/render_final',{project:S.P,parts,vparts});if(!r.ok)throw new Error(r.error||'start fail');
    for(;;){
      await sleep(800);
      const s=await api('/api/final_status');
      b.textContent='⛔ Cancel · 🎞 '+s.pct+'%';
      if(s.state==='done'){toast('✓ Video ban gayi: '+s.file+(s.msg?' ('+s.msg+')':''));break}
      if(s.state==='error')throw new Error(s.msg);
      if(s.state==='cancelled')throw new Error('cancelled');
    }
  }catch(err){console.error(err);toast('Render: '+err.message)}
  R.busy=false;R.cancel=false;b.textContent=old;
}

/* ================= library preview: hover = bada popup, click = full preview ================= */
let bigT=null;
function mediaView(m,full){
  if(m.type==='image'){
    const im=document.createElement('img');im.src=full?fileUrl(m.path):thumbUrl(m.path,0,960);
    im.onerror=()=>{if(!im._f){im._f=1;im.src=fileUrl(m.path)}};return im;
  }
  const v=document.createElement('video');v.muted=!full;v.controls=!!full;v.autoplay=true;v.loop=true;v.playsInline=true;v.src=fileUrl(m.path);
  let tried=false;
  v.onerror=async()=>{if(tried)return;tried=true;let ok=false;try{ok=(await api('/api/proxy?p='+encodeURIComponent(m.path))).ok}catch(e){}
    if(ok){v.src='/proxy?p='+encodeURIComponent(m.path);v.play().catch(()=>{})}};
  return v;
}
function showBig(m,el){
  clearTimeout(bigT);if(m.type==='audio')return;
  bigT=setTimeout(()=>{
    const p=$('bigpop'),mb=p.querySelector('.bm');mb.innerHTML='';mb.appendChild(mediaView(m,false));
    p.querySelector('.bt').innerHTML='<b>'+esc(m.name)+'</b> · '+m.type+(m.duration?' · '+fmtS(m.duration):'')+'<br><span style="color:#6d778c">'+esc(dirname(m.path))+'</span><br><span style="color:#9fb0d0">click = bada preview · double-click = timeline me jodo</span>';
    const r=el.getBoundingClientRect(),pw=Math.min(580,innerWidth-$('lib').offsetWidth-30);
    p.style.width=pw+'px';p.style.left=($('lib').offsetWidth+10)+'px';
    p.style.top=Math.max(8,Math.min(r.top-20,innerHeight-pw*.5625-100))+'px';p.style.display='block';
  },220);
}
function hideBig(){clearTimeout(bigT);const p=$('bigpop');p.style.display='none';p.querySelector('.bm').innerHTML=''}
function openLightbox(m){
  hideBig();const L=$('lightbox'),b=L.querySelector('.lb');b.innerHTML='';b.appendChild(mediaView(m,true));
  L.querySelector('.lc').textContent=m.name+'   ·   '+m.path+'   (Esc / bahar click = band)';L.classList.add('on');
}
function closeLightbox(){const L=$('lightbox');L.classList.remove('on');L.querySelector('.lb').innerHTML=''}
$('lightbox').onclick=e=>{if(!['IMG','VIDEO','BUTTON'].includes(e.target.tagName))closeLightbox()};

/* ================= timeline zoom / scroll / playhead / selection yaad rakho (reload ke baad wahin se) ================= */
let lastView='';
const viewKey=()=>'motion_view_'+S.file;
const viewSnap=()=>JSON.stringify([+S.scale.toFixed(3),+S.vs.toFixed(2),+S.time.toFixed(2),S.sel||'']);
function captureView(){S.P.view={scale:+S.scale.toFixed(3),vs:+S.vs.toFixed(2),time:+S.time.toFixed(2),sel:S.sel||''}}
function restoreView(){
  let v=null;try{v=JSON.parse(localStorage.getItem(viewKey())||'null')}catch(e){}
  v=v||S.P.view;if(!v||!v.scale)return;
  S.scale=Math.max(v.scale,fitScale());S.vs=v.vs||0;clampView();
  S.time=clamp(v.time||0,0,S.total-.001);
  if(v.sel&&byId(v.sel))select(v.sel);else{const c=clipAt(S.time);if(c)select(c.id)}
  layout();updatePlayheads();lastView=viewSnap();
}
setInterval(()=>{
  if(!S.P||S.playing)return;
  const v=viewSnap();if(v===lastView)return;
  lastView=v;captureView();try{localStorage.setItem(viewKey(),JSON.stringify(S.P.view))}catch(e){}scheduleSave();
},400);
window.addEventListener('beforeunload',()=>{if(!S.P)return;captureView();try{localStorage.setItem(viewKey(),JSON.stringify(S.P.view))}catch(e){}});

/* ================= Max view (full screen result) ================= */
const isFS=()=>!!(document.fullscreenElement||document.webkitFullscreenElement);
function toggleMax(){
  try{
    if(isFS()){const f=document.exitFullscreen||document.webkitExitFullscreen;const p=f.call(document);if(p&&p.catch)p.catch(()=>{})}
    else{const el=$('center'),f=el.requestFullscreen||el.webkitRequestFullscreen;const p=f.call(el);if(p&&p.catch)p.catch(()=>toast('Full screen allow nahi hui'))}
  }catch(e){toast('Full screen is browser me nahi chali')}
}
function fsbarUpdate(){
  if(!isFS())return;
  const sk=$('fsseek');if(document.activeElement!==sk)sk.value=Math.round(S.time/S.total*1000);
  $('fstt').textContent=fmtS(S.time)+' / '+fmtS(S.total);
}
let fsT=null;
function showFsBar(){const b=$('fsbar');b.classList.add('show');clearTimeout(fsT);fsT=setTimeout(()=>b.classList.remove('show'),2500)}
$('center').addEventListener('mousemove',()=>{if(isFS())showFsBar()});
['fullscreenchange','webkitfullscreenchange'].forEach(ev=>document.addEventListener(ev,()=>{
  $('maxb').textContent=isFS()?'⛶ Exit':'⛶ Max view';fitStage();if(isFS())showFsBar();
}));
$('cv').addEventListener('click',()=>{if(isFS())togglePlay()});
$('cv').addEventListener('dblclick',toggleMax);
$('fsseek').oninput=e=>seek(e.target.value/1000*S.total,true);
$('fsseek').onpointerup=()=>$('fsseek').blur();

/* audio_look/ folder ki saari animation files load karo (ek class = ek file) */
window.addEventListener('error',e=>{if(e.filename&&(e.filename.includes('/audio_look/')||e.filename.includes('/motions/')))toast('⚠ '+decodeURIComponent(e.filename.split('/').pop().split('?')[0])+': '+e.message)});
/* ================= AUDIO: video ki awaaz + SFX tracks + mute / dB + waveform + copy-paste ================= */
const RV=28,VH=96,RVA=128,VAH=46,RA=178,AH=64,RS=250,SH=54,SG=4;
const sfxTop=i=>RS+i*(SH+SG);
const tlHeight=()=>RS+Math.max(1,S.P.atracks.length)*(SH+SG)+34;
const dbLin=db=>Math.pow(10,(+db||0)/20);
const aById=id=>S.P.aclips.find(a=>a.id===id);
const trackIdx=a=>Math.max(0,S.P.atracks.findIndex(t=>t.id===a.track));
const trackOf=a=>S.P.atracks.find(t=>t.id===a.track)||{mute:false,vol:0};
const ctlOf=k=>k==='v'?S.P.vtrack:k==='a'?S.P.audio:S.P.atracks.find(t=>'t'+t.id===k);
const clone=o=>JSON.parse(JSON.stringify(o));
const newTrack=()=>({id:uid().slice(1),name:'SFX '+(S.P.atracks.length+1),mute:false,vol:0});
function addTrack(){pushUndo();S.P.atracks.push(newTrack());changed()}
function normA(a){a.start=r3(Math.max(0,a.start));a.duration=r3(Math.max(.1,a.duration));a.in=r3(Math.max(0,a.in||0));
  a.fi=Math.min(+a.fi||0,a.duration);a.fo=Math.min(+a.fo||0,a.duration);a.vol=+a.vol||0}

/* ---- WebAudio: har audio element ek gain se guzarta hai (dB, fade, mute; +dB boost bhi) ---- */
let AC=null;
function ensureAC(){
  if(AC===null){try{AC=new (window.AudioContext||window.webkitAudioContext)()}catch(e){AC=false}}
  if(AC&&AC.state==='suspended')AC.resume().catch(()=>{});
  return AC;
}
function route(el){
  if(el._g!==undefined)return el._g;
  if(!ensureAC()){el._g=null;return null}
  try{const g=AC.createGain();AC.createMediaElementSource(el).connect(g);g.connect(AC.destination);el._g=g}catch(e){el._g=null}
  return el._g;
}
function setGain(el,lin){const g=route(el);if(g)g.gain.value=lin;else el.volume=clamp(lin,0,1)}

/* ---- playback: main audio gain + SFX pool (play par sab chalta hai) ---- */
const SPOOL={};
function poolEl(a){
  let p=SPOOL[a.id];
  if(!p||p.src!==a.resource){
    if(p)p.el.pause();
    const el=new Audio();el.preload='auto';el.src=fileUrl(a.resource);p={el,src:a.resource};SPOOL[a.id]=p;route(el);
  }
  return p;
}
function pruneAudio(){for(const k in SPOOL){if(!S.P.aclips.some(a=>a.id===k)){SPOOL[k].el.pause();delete SPOOL[k]}}}
function syncAudio(){
  const P=S.P;if(!P)return;
  setGain(au,P.audio.mute?0:dbLin(P.audio.vol));
  const t=S.time;
  for(const a of P.aclips){
    const tr=trackOf(a),inside=t>=a.start&&t<a.start+a.duration-1e-6;
    const act=S.playing&&inside&&!a.mute&&!tr.mute,p0=SPOOL[a.id];
    if(!act){if(p0&&!p0.el.paused)p0.el.pause();continue}
    const p=poolEl(a),e=p.el,want=(a.in||0)+(t-a.start);
    if(e.readyState>=1){
      if(e.paused){if(!(e.duration&&want>=e.duration-.03)){try{e.currentTime=want}catch(x){}e.play().catch(()=>{})}}
      else if(Math.abs(e.currentTime-want)>.3){try{e.currentTime=want}catch(x){}}
    }
    let g=dbLin((+a.vol||0)+(+tr.vol||0));
    if(a.fi>0)g*=clamp((t-a.start)/a.fi,0,1);
    if(a.fo>0)g*=clamp((a.start+a.duration-t)/a.fo,0,1);
    setGain(e,g);
  }
}

/* ---- waveform (video ki awaaz + SFX) ---- */
const PK={};
function getPk(path){
  let p=PK[path];if(p)return p;
  p=PK[path]={state:'working',peaks:[],pps:10};
  (async()=>{
    try{for(;;){const r=await api('/api/peaks?p='+encodeURIComponent(path));
      if(r.state==='working'){await sleep(1200);continue}
      p.state=r.state==='ready'?'ready':'error';p.peaks=r.peaks||[];p.pps=r.pps||10;break}}
    catch(e){p.state='error'}
    layoutAudio();
  })();
  return p;
}
function paintWave(e,path,inT,dur,w,color){
  const cv=e.querySelector('canvas');if(!cv)return;
  const pk=getPk(path);if(pk.state==='working')return;
  if(pk.state==='error'||!pk.peaks.length){e.classList.add('noaud');return}
  e.classList.remove('noaud');
  const cw=Math.min(4096,Math.max(1,Math.round(w))),sig=cw+'|'+inT+'|'+dur+'|'+pk.peaks.length;
  if(cv._sig===sig)return;cv._sig=sig;cv.width=cw;cv.height=40;
  const c=cv.getContext('2d');c.clearRect(0,0,cw,40);c.fillStyle=color;
  for(let x=0;x<cw;x++){
    const t=inT+x/cw*dur,i0=Math.floor(t*pk.pps),i1=Math.max(i0+1,Math.floor((t+dur/cw)*pk.pps));let m=0;
    for(let i=i0;i<i1&&i<pk.peaks.length;i++)if(pk.peaks[i]>m)m=pk.peaks[i];
    const h=Math.max(1,m*38);c.fillRect(x,20-h/2,1,h);
  }
}
function layoutAudio(){
  if(!S.P)return;
  const Wd=tl.clientWidth;
  for(const c of S.P.clips){
    const e=S.vaEls[c.id];if(!e)continue;
    const x=PAD+(c.start-S.vs)*S.scale,w=Math.max(c.duration*S.scale-1,3);
    e.style.left=x+'px';e.style.width=w+'px';
    if(x+w>0&&x<Wd)paintWave(e,c.resource,c.in||0,c.duration,w,'#9fd0ff');
  }
  for(const a of S.P.aclips){
    const e=S.sxEls[a.id];if(!e)continue;
    const x=PAD+(a.start-S.vs)*S.scale,w=Math.max(a.duration*S.scale-1,3);
    e.style.left=x+'px';e.style.width=w+'px';e.style.top=sfxTop(trackIdx(a))+'px';
    if(x+w>0&&x<Wd)paintWave(e,a.resource,a.in||0,a.duration,w,'#ffd479');
  }
}

/* ---- timeline rows / headers / elements ---- */
function buildRows(){
  const r=$('rows');r.innerHTML='';
  const add=(top,h,cls,html)=>{const d=document.createElement('div');d.className='trk '+(cls||'');d.style.top=top+'px';d.style.height=h+'px';if(html)d.innerHTML=html;r.appendChild(d)};
  add(RV-2,VH+4);add(RVA-2,VAH+4,'va');add(RA-2,AH+4);
  if(!S.P.atracks.length)add(sfxTop(0)-2,SH+4,'ph0','<span>🔊 SFX audio yahan girao (SFX track khud ban jayega)</span>');
  S.P.atracks.forEach((t,i)=>add(sfxTop(i)-2,SH+4,t.mute?'mt':''));
  const h=tlHeight();tl.style.height=h+'px';$('hdrs').style.height=h+'px';
}
function renderHdrs(){
  const h=$('hdrs');h.innerHTML='';const P=S.P;
  const mk=(top,ht,html)=>{const d=document.createElement('div');d.className='hd';d.style.top=top+'px';d.style.height=ht+'px';d.innerHTML=html;h.appendChild(d)};
  const mute=(k,c)=>`<button class="mb${c.mute?' on':''}" data-act="mute" data-k="${k}" title="mute / unmute">${c.mute?'🔇 Mute':'🔊'}</button>`;
  const vol=(k,c)=>`<div class="vrow"><input class="dbr" data-k="${k}" type="range" min="-40" max="12" step="1" value="${+c.vol||0}" title="volume (dB)"><input class="db" data-k="${k}" type="number" step="1" value="${+c.vol||0}" title="volume dB"><span>dB</span></div>`;
  mk(RV,VH,'<b>V1</b>');
  mk(RVA,VAH,'<b title="video clips ki apni awaaz">🎞 Video awaaz</b>'+mute('v',P.vtrack)+'<span></span>'+vol('v',P.vtrack));
  mk(RA,AH,'<b title="main audio">A1 · main</b>'+mute('a',P.audio)+'<span></span>'+vol('a',P.audio));
  P.atracks.forEach((t,i)=>mk(sfxTop(i),SH,`<b data-act="ren" data-k="t${t.id}" title="double-click = rename">${esc(t.name)}</b>`+mute('t'+t.id,t)+`<button class="mb x" data-act="del" data-k="t${t.id}" title="track hatao">✕</button>`+vol('t'+t.id,t)));
  const add=document.createElement('div');add.className='hd add';add.style.top=sfxTop(Math.max(1,P.atracks.length))+'px';add.style.height='28px';
  add.innerHTML='<button data-act="add">＋ SFX track</button>';h.appendChild(add);
}
$('hdrs').addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const act=b.dataset.act,k=b.dataset.k;
  if(act==='mute'){const c=ctlOf(k);if(!c)return;pushUndo();c.mute=!c.mute;renderHdrs();buildRows();
    for(const cl of S.P.clips)if(S.vaEls[cl.id])refreshVaEl(cl);for(const a of S.P.aclips)refreshSfxEl(a);scheduleSave()}
  else if(act==='del'){
    const t=S.P.atracks.find(x=>'t'+x.id===k);if(!t)return;const n=S.P.aclips.filter(a=>a.track===t.id).length;
    if(n&&!confirm('"'+t.name+'" track me '+n+' SFX clips hain, sab hat jayenge. Aage badhein?'))return;
    pushUndo();S.P.atracks=S.P.atracks.filter(x=>x!==t);S.P.aclips=S.P.aclips.filter(a=>a.track!==t.id);
    if(S.selA&&!aById(S.selA))S.selA=null;changed();
  }
  else if(act==='add')addTrack();
});
let hdrUndo=false;
$('hdrs').addEventListener('input',e=>{
  const t=e.target;if(!t.classList.contains('db')&&!t.classList.contains('dbr'))return;
  const c=ctlOf(t.dataset.k);if(!c)return;
  if(!hdrUndo){pushUndo();hdrUndo=true}
  c.vol=clamp(parseFloat(t.value)||0,-60,24);
  const row=t.closest('.vrow');row.querySelector('.db').value=c.vol;row.querySelector('.dbr').value=c.vol;
  for(const a of S.P.aclips)refreshSfxEl(a);for(const cl of S.P.clips)if(S.vaEls[cl.id])refreshVaEl(cl);scheduleSave();
});
$('hdrs').addEventListener('change',()=>{hdrUndo=false});
$('hdrs').addEventListener('dblclick',e=>{
  const b=e.target.closest('[data-act="ren"]');if(!b)return;const t=ctlOf(b.dataset.k);if(!t)return;
  const n=prompt('Track ka naam:',t.name);if(n){pushUndo();t.name=n;renderHdrs();scheduleSave()}
});
function mkSfx(a){
  const e=document.createElement('div');e.className='sx';e.dataset.id=a.id;
  e.innerHTML='<canvas class="cw"></canvas><div class="sxt"></div><i class="hl"></i><i class="hr"></i>';
  e.addEventListener('mousedown',ev=>{
    if(ev.button!==0)return;ev.stopPropagation();
    const mode=ev.target.classList.contains('hl')?'l':ev.target.classList.contains('hr')?'r':'move';
    D={kind:'a',mode,id:a.id,x0:ev.clientX,y0:ev.clientY,s0:a.start,d0:a.duration,in0:a.in||0,moved:false,clickT:timeAtX(ev.clientX)};
    selectA(a.id);
  });
  return e;
}
function mkVa(c){
  const e=document.createElement('div');e.className='va';e.innerHTML='<canvas class="cw"></canvas><div class="sxt"></div>';
  e.addEventListener('mousedown',ev=>{
    if(ev.button!==0)return;ev.stopPropagation();
    if(S.selA){S.selA=null;markSelA();updateAProps()}
    select(c.id);seek(timeAtX(ev.clientX),true);
  });
  return e;
}
function refreshSfxEl(a){
  const e=S.sxEls[a.id];if(!e)return;const m=!!(a.mute||trackOf(a).mute);
  e.querySelector('.sxt').textContent=(m?'🔇 ':'')+(a.name||base(a.resource))+((+a.vol||0)?'  '+(a.vol>0?'+':'')+a.vol+'dB':'');
  e.classList.toggle('mt',m);e.title=(a.name||'')+'  '+a.start.toFixed(2)+'s → '+(a.start+a.duration).toFixed(2)+'s';
}
function refreshVaEl(c){
  const e=S.vaEls[c.id];if(!e)return;const m=!!(S.P.vtrack.mute||c.amute);
  e.querySelector('.sxt').textContent=(m?'🔇 ':'🔊 ')+(c.name||base(c.resource))+((+c.vol_db||0)?'  '+(c.vol_db>0?'+':'')+c.vol_db+'dB':'');
  e.classList.toggle('mt',m);
}
function markSelA(){for(const k in S.sxEls)S.sxEls[k].classList.toggle('sel',k===S.selA)}
function selectA(id){S.selA=id;markSelA();updateAProps()}
function buildTimeline(){
  tl.querySelectorAll('.clip,.sx,.va').forEach(e=>e.remove());S.els={};S.sxEls={};S.vaEls={};
  buildRows();renderHdrs();
  for(const c of S.P.clips){
    const e=mkClip(c);tl.insertBefore(e,$('ghost'));S.els[c.id]=e;refreshClipEl(c);
    if(c.type==='video'){const v=mkVa(c);tl.insertBefore(v,$('ghost'));S.vaEls[c.id]=v;refreshVaEl(c)}
  }
  for(const a of S.P.aclips){const e=mkSfx(a);tl.insertBefore(e,$('ghost'));S.sxEls[a.id]=e;refreshSfxEl(a)}
  markSelA();layout();
}

/* ---- SFX clip drag (move / trim / track badlo) ---- */
function dragA(ev){
  const a=aById(D.id);if(!a)return;
  const dx=ev.clientX-D.x0;
  if(!D.moved){if(Math.abs(dx)<3&&Math.abs(ev.clientY-D.y0)<3)return;pushUndo();D.moved=true}
  if(D.mode==='move'){
    let t=D.s0+dx/S.scale;const s1=snapT(t,a.id),s2=snapT(t+a.duration,a.id);
    if(s1!==null)t=s1;else if(s2!==null)t=s2-a.duration;
    a.start=r3(Math.max(0,t));
    const y=ev.clientY-tl.getBoundingClientRect().top,ti=clamp(Math.floor((y-RS)/(SH+SG)),0,S.P.atracks.length-1);
    if(S.P.atracks[ti])a.track=S.P.atracks[ti].id;
  }else if(D.mode==='l'){
    let s=D.s0+dx/S.scale;const sn=snapT(s,a.id);if(sn!==null)s=sn;
    s=clamp(s,Math.max(0,D.s0-D.in0),D.s0+D.d0-.1);
    a.start=r3(s);a.duration=r3(D.s0+D.d0-s);a.in=r3(D.in0+(s-D.s0));
  }else{
    let e2=D.s0+D.d0+dx/S.scale;const sn=snapT(e2,a.id);if(sn!==null)e2=sn;
    const hi=a.src_duration?D.s0+(a.src_duration-D.in0):Infinity;
    a.duration=r3(clamp(e2,D.s0+.1,hi)-D.s0);
  }
  refreshSfxEl(a);computeTotal();layout();updateAProps();
}
function upA(d){const a=aById(d.id);if(!a)return;if(d.moved)changed();else seek(clamp(d.clickT,a.start,a.start+a.duration-.001),true)}

/* ---- SFX add / delete / split ---- */
async function addSfx(m,t,ti){
  if(!m||m.type!=='audio')return;
  pushUndo();
  if(!S.P.atracks.length)S.P.atracks.push(newTrack());
  ti=clamp(ti==null||isNaN(ti)?(S.lastTrack||0):ti,0,S.P.atracks.length);
  if(ti===S.P.atracks.length)S.P.atracks.push(newTrack());
  let dur=m.duration;
  if(!dur){try{const p=await api('/api/probe?p='+encodeURIComponent(m.path));if(p.duration){dur=r3(p.duration);m.duration=dur}}catch(e){}}
  const a={id:uid(),track:S.P.atracks[ti].id,resource:m.path,name:m.name||base(m.path),start:r3(Math.max(0,t)),duration:r3(dur||3),in:0,src_duration:r3(dur||0),vol:0,fi:0,fo:0,mute:false};
  S.P.aclips.push(a);S.lastTrack=ti;changed();selectA(a.id);toast('🔊 SFX: '+a.name+' · '+a.start.toFixed(2)+'s · '+S.P.atracks[ti].name);
}
function deleteA(id){const a=aById(id);if(!a)return;pushUndo();S.P.aclips=S.P.aclips.filter(x=>x!==a);S.selA=null;changed()}
function splitA(){
  const a=aById(S.selA);if(!a)return;
  const t=S.time-a.start;if(t<.1||a.duration-t<.1)return toast('split ke liye playhead SFX ke andar rakho');
  pushUndo();const old=a.duration,B=clone(a);B.id=uid();
  a.duration=r3(t);a.fo=0;B.start=r3(a.start+t);B.duration=r3(old-t);B.in=r3((a.in||0)+t);B.fi=0;
  S.P.aclips.push(B);changed();
}

/* ---- audio properties panel (SFX ya video ki awaaz) ---- */
function updateAProps(){
  const box=$('aprops'),a=S.selA?aById(S.selA):null,c=curClip();
  const mode=a?'a':(c&&c.type==='video'?'v':null);
  if(!mode){box.style.display='none';box.dataset.mode='';return}
  box.style.display='grid';box.dataset.mode=mode;
  $('apt').textContent=mode==='a'?'🔊 SFX · '+(a.name||base(a.resource)):'🎞 video ki awaaz · '+(c.name||base(c.resource));
  $('ap_vol').value=mode==='a'?(+a.vol||0):(+c.vol_db||0);
  $('ap_m').checked=mode==='a'?!!a.mute:!!c.amute;
  box.querySelectorAll('.fx').forEach(x=>x.style.display=mode==='a'?'':'none');
  if(mode==='a'){$('ap_fi').value=a.fi||0;$('ap_fo').value=a.fo||0;$('ap_s').value=a.start;$('ap_d').value=a.duration;$('ap_in').value=a.in||0}
}
const apSet=fn=>()=>{
  const mode=$('aprops').dataset.mode,o=mode==='a'?aById(S.selA):curClip();if(!o)return;
  pushUndo();fn(o,mode);
  if(mode==='a'){normA(o);refreshSfxEl(o)}else refreshVaEl(o);
  computeTotal();layout();updateAProps();scheduleSave();
};
$('ap_vol').onchange=apSet((o,m)=>{const v=clamp(parseFloat($('ap_vol').value)||0,-60,24);if(m==='a')o.vol=v;else o.vol_db=v});
$('ap_m').onchange=apSet((o,m)=>{if(m==='a')o.mute=$('ap_m').checked;else o.amute=$('ap_m').checked});
$('ap_fi').onchange=apSet(o=>{o.fi=Math.max(0,parseFloat($('ap_fi').value)||0)});
$('ap_fo').onchange=apSet(o=>{o.fo=Math.max(0,parseFloat($('ap_fo').value)||0)});
$('ap_s').onchange=apSet(o=>{o.start=Math.max(0,parseFloat($('ap_s').value)||0)});
$('ap_d').onchange=apSet(o=>{let d=Math.max(.1,parseFloat($('ap_d').value)||o.duration);if(o.src_duration)d=Math.min(d,o.src_duration-(o.in||0));o.duration=d});
$('ap_in').onchange=apSet(o=>{o.in=Math.max(0,parseFloat($('ap_in').value)||0)});
$('ap_del').onclick=()=>deleteA(S.selA);

/* ---- library: audio ko click = suno (preview) ---- */
let PA=null,PAel=null;
function previewAudio(m,el){
  const same=PA&&PA._m===m;
  if(PA){PA.pause();PA=null;if(PAel)PAel.classList.remove('pl');PAel=null}
  if(same)return;
  PA=new Audio(fileUrl(m.path));PA._m=m;PAel=el;el.classList.add('pl');
  PA.onended=()=>{el.classList.remove('pl');PA=null;PAel=null};PA.play().catch(()=>{});
}

/* ---- copy / paste / duplicate: clip (effects + animations ke saath), SFX, ya effect / animation ---- */
function copySel(){
  if(S.fxObj){S.clipb={kind:isVis()?'vis':'fx',data:clone(S.fxObj)};return toast('copy: '+lname(S.fxObj.key)+'  (Ctrl+V = playhead par paste)')}
  if(S.selA){const a=aById(S.selA);if(a){S.clipb={kind:'sfx',data:clone(a)};return toast('SFX copy  (Ctrl+V = playhead par paste)')}}
  const c=curClip();if(!c)return toast('pehle clip chuno');
  S.clipb={kind:'clip',data:clone(c)};toast('clip copy · effects / animations saath  (Ctrl+V = playhead par paste)');
}
function pasteClip(){
  const b=S.clipb;if(!b)return toast('pehle Ctrl+C se copy karo');
  const n=clone(b.data);
  if(b.kind==='clip'){
    pushUndo();n.id=uid();(n.vis||[]).forEach(v=>v.id=uid());
    n.start=r3(fitPos(S.time,n.duration,n.id));S.P.clips.push(n);changed();select(n.id);seek(n.start,false);ensureVisible(n.start);
    toast('✓ paste: '+n.start.toFixed(2)+'s par');
  }else if(b.kind==='sfx'){
    pushUndo();if(!S.P.atracks.length)S.P.atracks.push(newTrack());
    if(!S.P.atracks.some(t=>t.id===n.track))n.track=S.P.atracks[0].id;
    n.id=uid();n.start=r3(S.time);S.P.aclips.push(n);changed();selectA(n.id);toast('✓ SFX paste: '+n.start.toFixed(2)+'s');
  }else{
    const d=curClip();if(!d)return toast('pehle wo clip chuno jis par paste karna hai');
    if(b.kind==='fx'&&d.type!=='image')return toast('image effect sirf image clip par lagta hai');
    const want=b.kind==='vis'?'vis':'fx';if(S.tab!==want)setTab(want);
    pushUndo();
    const loc=clamp(S.time-d.start,0,Math.max(0,d.duration-.3));
    if(b.kind==='fx'){const ne=addFxData(d,n.key,loc,0);ne.dur=+Math.max(.3,Math.min(n.dur,d.duration-ne.start)).toFixed(2);S.fxObj=ne}
    else{n.id=uid();n.start=+q05(loc).toFixed(2);n.dur=+Math.max(.3,Math.min(n.dur,d.duration-n.start)).toFixed(2);(d.vis||(d.vis=[])).push(n);S.fxObj=n}
    commitFx(d);toast('✓ paste: '+(+S.fxObj.start).toFixed(2)+'s se (clip ke andar)');
  }
}
function duplicateSel(){
  if(S.fxObj){const d=curClip();if(!d)return;copySel();const old=S.time;S.time=d.start+Math.min(d.duration-.3,S.fxObj.start+S.fxObj.dur);pasteClip();return}
  if(S.selA){const a=aById(S.selA);if(!a)return;S.clipb={kind:'sfx',data:clone(a)};S.time=a.start+a.duration;pasteClip();return}
  const c=curClip();if(!c)return toast('pehle clip chuno');
  S.clipb={kind:'clip',data:clone(c)};S.time=c.start+c.duration;pasteClip();
}

/* ================= layout: splitters (drag se size), library thumbnail size ================= */
const appEl=$('app');
function setCols(n){document.documentElement.style.setProperty('--cols',n);
  document.querySelectorAll('#tabs .sz').forEach(x=>x.classList.toggle('on',+x.dataset.s===n));saveLayout()}
function saveLayout(){
  try{localStorage.setItem('motion_layout',JSON.stringify({lw:appEl.style.getPropertyValue('--lw'),rw:appEl.style.getPropertyValue('--rw'),
    th:appEl.style.getPropertyValue('--th'),cols:+getComputedStyle(document.documentElement).getPropertyValue('--cols')||2}))}catch(e){}
}
function applyLayout(){
  let v=null;try{v=JSON.parse(localStorage.getItem('motion_layout')||'null')}catch(e){}
  v=v||{};
  if(v.lw)appEl.style.setProperty('--lw',v.lw);if(v.rw)appEl.style.setProperty('--rw',v.rw);if(v.th)appEl.style.setProperty('--th',v.th);
  setCols(v.cols||2);
}
(function(){
  const drag=(el,fn)=>el.addEventListener('mousedown',e=>{
    e.preventDefault();el.classList.add('act');
    const mv=ev=>fn(ev),up=()=>{removeEventListener('mousemove',mv);removeEventListener('mouseup',up);el.classList.remove('act');saveLayout()};
    addEventListener('mousemove',mv);addEventListener('mouseup',up);
  });
  drag($('spL'),ev=>appEl.style.setProperty('--lw',clamp(ev.clientX,200,720)+'px'));
  drag($('spR'),ev=>appEl.style.setProperty('--rw',clamp(innerWidth-ev.clientX,240,640)+'px'));
  drag($('spB'),ev=>appEl.style.setProperty('--th',clamp(innerHeight-ev.clientY-130,150,innerHeight-330)+'px'));
})();
new ResizeObserver(()=>{if(S.P){layout();renderLane()}}).observe($('tlscroll'));

async function loadScripts(listApi,dir){
  let files=[];
  try{files=(await api(listApi)).files||[]}catch(e){console.error(e)}
  for(const f of files){
    await new Promise(res=>{const sc=document.createElement('script');sc.src='/'+dir+'/'+encodeURIComponent(f)+'?v='+Date.now();
      sc.onload=res;sc.onerror=()=>{console.error(dir+'/'+f+' load nahi hui');toast('⚠ '+dir+'/'+f+' load nahi hui');res()};document.head.appendChild(sc)});
  }
}
/* motions/*.js (image effects) aur audio_look/*.js (audio animations): folder ki saari files; "_" se shuru = band */
async function loadAudioLook(){
  await loadScripts('/api/motions_list','motions');
  await loadScripts('/api/audio_look','audio_look');
  const seen={},dup=[];for(const m of (window.MOTIONS||[])){if(seen[m.key]&&!dup.includes(m.key))dup.push(m.key);seen[m.key]=1}
  if(dup.length)toast('⚠ duplicate effect key: '+dup.join(', '));
}
async function init(){
  applyLayout();
  const r=await api('/api/init');S.root=r.root;S.file=r.file;S.P=r.project;S.numpy=r.numpy;
  if(!r.ffmpeg)toast('⚠ ffmpeg / ffprobe PATH me nahi mila (thumbnail + render ke liye zaruri)');
  await loadAudioLook();afterLoad();requestAnimationFrame(loop);
}
init();
</script></body></html>
"""


FAVICON_SVG = """<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#6b3fa0'/><rect x='9' y='10' width='46' height='34' rx='5' fill='#1b1e27'/><path d='M27 18l15 9-15 9z' fill='#ffd479'/><rect x='9' y='49' width='30' height='5' rx='2.5' fill='#7ee787'/><rect x='43' y='49' width='12' height='5' rx='2.5' fill='#c24bff'/></svg>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, ctype):
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path):
        if not path or not os.path.isfile(path):
            return self.send_error(404)
        size = os.path.getsize(path)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        start, end, code = 0, size - 1, 200
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
            else:
                start = max(size - int(m.group(2)), 0)
            code = 206
        if start >= size:
            return self.send_error(416)
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        u = urlparse(self.path)
        path = unquote(u.path)
        q = parse_qs(u.query)

        def g(k, d=""):
            return q.get(k, [d])[0]

        if path == "/":
            self.send_text(HTML, "text/html; charset=utf-8")
        elif path in ("/favicon.ico", "/favicon.svg"):
            self.send_text(FAVICON_SVG, "image/svg+xml")
        elif path == "/motions.js":
            ensure_motions_file()
            with open(MOTIONS_JS, encoding="utf-8") as f:
                self.send_text(f.read(), "application/javascript; charset=utf-8")
        elif path == "/api/init":
            proj = load_project(CUR[0])
            self.send_json({"root": ROOT, "file": os.path.basename(CUR[0]), "project": proj,
                            "ffmpeg": has("ffmpeg") and has("ffprobe"), "numpy": has_numpy()})
        elif path == "/api/projects":
            self.send_json({"projects": list_projects()})
        elif path == "/audio_animations.js":
            fp = os.path.join(HERE, "audio_animations.js")
            if os.path.isfile(fp):
                with open(fp, encoding="utf-8") as f:
                    self.send_text(f.read(), "application/javascript; charset=utf-8")
            else:
                self.send_text("window.AUDIO_ANIMS = window.AUDIO_ANIMS || [];", "application/javascript; charset=utf-8")
        elif path in ("/api/audio_look", "/api/motions_list"):
            d = os.path.join(HERE, "audio_look" if path == "/api/audio_look" else "motions")
            files = sorted((f for f in os.listdir(d) if f.lower().endswith(".js") and not f.startswith("_")), key=natkey) if os.path.isdir(d) else []
            self.send_json({"files": files})
        elif path.startswith("/audio_look/") or path.startswith("/motions/"):
            folder = "audio_look" if path.startswith("/audio_look/") else "motions"
            fp = os.path.join(HERE, folder, os.path.basename(path))
            if os.path.isfile(fp):
                with open(fp, encoding="utf-8") as f:
                    self.send_text(f.read(), "application/javascript; charset=utf-8")
            else:
                self.send_error(404)
        elif path == "/motion_kit.js":
            fp = os.path.join(HERE, "motion_kit.js")
            if os.path.isfile(fp):
                with open(fp, encoding="utf-8") as f:
                    self.send_text(f.read(), "application/javascript; charset=utf-8")
            else:
                self.send_text("window.MKIT = window.MKIT || {};", "application/javascript; charset=utf-8")
        elif path == "/api/clip_status":
            self.send_json({k: CJOB[k] for k in ("state", "msg", "file")})
        elif path == "/api/vis_status":
            self.send_json({k: VIS[k] for k in ("state", "pct", "msg", "path")})
        elif path == "/api/vis_data":
            try:
                self.send_json(vis_data())
            except Exception as e:
                self.send_json({"error": "audio_data.npz nahi padh paye: " + str(e)})
        elif path == "/api/ls":
            self.send_json(list_dir(g("path"), g("mode", "media")))
        elif path == "/api/scan":
            p = g("path")
            self.send_json({"files": scan_dir(p, g("rec") == "1") if os.path.isdir(p) else []})
        elif path == "/api/probe":
            self.send_json(probe(g("p")))
        elif path == "/api/peaks":
            st = peaks_get(g("p"))
            self.send_json({"state": st["state"], "pps": st.get("pps", 10), "peaks": st["peaks"] if st["state"] == "ready" else []})
        elif path == "/api/proxy":
            self.send_json({"ok": bool(make_proxy(g("p")))})
        elif path == "/api/final_status":
            self.send_json({k: FINAL[k] for k in ("state", "pct", "msg", "file")})
        elif path == "/file":
            self.send_file(g("p"))
        elif path == "/thumb":
            p = g("p")
            try:
                out = make_thumb(p, float(g("t", "0") or 0), int(g("w", "240") or 240))
            except ValueError:
                out = None
            if out:
                self.send_file(out)
            elif kind(p) == "image":
                self.send_file(p)
            else:
                self.send_error(404)
        elif path == "/proxy":
            self.send_file(make_proxy(g("p")))
        else:
            self.send_error(404)

    def do_POST(self):
        u = urlparse(self.path)
        path = u.path
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n)
        if path == "/api/render_frame":
            ok, err = render_frame(parse_qs(u.query).get("job", [""])[0], raw)
            return self.send_json({"ok": ok, "error": err}, 200 if ok else 500)
        body = json.loads(raw or b"{}")
        if path == "/api/save":
            proj = body.get("project")
            if not isinstance(proj, dict):
                return self.send_json({"ok": False}, 400)
            if body.get("as"):
                nm = safe_name(re.sub(r"\.json$", "", str(body["as"]), flags=re.I))
                CUR[0] = os.path.join(HERE, nm + ".json")
            save_project(CUR[0], proj)
            self.send_json({"ok": True, "file": os.path.basename(CUR[0])})
        elif path == "/api/open":
            fp = os.path.join(HERE, os.path.basename(str(body.get("file", ""))))
            if not os.path.isfile(fp):
                return self.send_json({"ok": False}, 404)
            CUR[0] = fp
            self.send_json({"ok": True, "file": os.path.basename(fp), "project": load_project(fp)})
        elif path == "/api/new":
            nm = safe_name(body.get("name") or "project")
            CUR[0] = os.path.join(HERE, nm + ".json")
            p = default_project(nm)
            save_project(CUR[0], p)
            self.send_json({"ok": True, "file": os.path.basename(CUR[0]), "project": p})
        elif path == "/api/import_old":
            p = body.get("path") or ""
            cands = [p] if p else [os.path.join(HERE, "animate_data.json"), os.path.join(HERE, "animate_data.py")]
            cands = [c if os.path.isabs(c) else os.path.join(HERE, c) for c in cands]
            fp = next((c for c in cands if os.path.isfile(c)), None)
            if not fp:
                return self.send_json({"ok": False, "error": "animate_data file nahi mili"})
            try:
                if fp.endswith(".py"):
                    items = load_module(fp, "animate_data_old").data_x
                else:
                    with open(fp, encoding="utf-8") as f:
                        items = json.load(f)
                self.send_json({"ok": True, "project": convert_old(items, os.path.splitext(os.path.basename(CUR[0]))[0])})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)})
        elif path == "/api/export":
            proj = body.get("project", {})
            out = []
            for c in sorted(proj.get("clips", []), key=lambda c: c.get("start", 0)):
                d = {"resource": c.get("resource"), "type": c.get("type"), "start": c.get("start"), "end": c.get("end"),
                     "duration": c.get("duration"), "output": c.get("output"), "animate": c.get("animate", ""),
                     "default_animate": c.get("default_animate", 1), "view": c.get("view", 16)}
                if c.get("type") == "image":
                    d["motion"] = c.get("motion", "")
                d["in"], d["out"] = c.get("in", 0), c.get("out", c.get("duration"))
                if c.get("type") == "image":
                    d["effects"] = c.get("effects", [])
                out.append(d)
            with open(EXPORT_PY, "w", encoding="utf-8") as f:
                f.write("data_x = " + pprint.pformat(out, sort_dicts=False, width=100) + "\n")
            self.send_json({"ok": True, "file": os.path.basename(EXPORT_PY)})
        elif path == "/api/vis_ensure":
            ok, info = vis_ensure(str(body.get("path", "")))
            self.send_json({"ok": ok, "state": info if ok else "", "error": "" if ok else info})
        elif path == "/api/exists":
            self.send_json({"have": [f for f in body.get("files", []) if os.path.isfile(os.path.join(HERE, f))]})
        elif path == "/api/render_start":
            jid, info = render_start(str(body.get("out", "motion.mp4")), int(body.get("fps", 25)))
            if not jid:
                return self.send_json({"ok": False, "error": info}, 500)
            self.send_json({"ok": True, "job": jid})
        elif path == "/api/render_end":
            ok, info = render_end(str(body.get("job", "")))
            self.send_json({"ok": ok, "file": os.path.relpath(info, HERE) if ok else "", "error": "" if ok else info},
                           200 if ok else 500)
        elif path == "/api/render_cancel":
            render_cancel(str(body.get("job", "")))
            self.send_json({"ok": True})
        elif path == "/api/render_clip":
            if CJOB["state"] == "running":
                return self.send_json({"ok": False, "error": "clip render pehle se chal raha hai"})
            if not has("ffmpeg"):
                return self.send_json({"ok": False, "error": "ffmpeg install nahi hai"})
            CJOB.update(state="running", msg="", file="")
            threading.Thread(target=render_clip_worker, args=(body.get("project", {}), body.get("id", ""), body.get("vpart", "")), daemon=True).start()
            self.send_json({"ok": True})
        elif path == "/api/render_final":
            if FINAL["state"] == "running":
                return self.send_json({"ok": False, "error": "render pehle se chal raha hai"})
            if not has("ffmpeg"):
                return self.send_json({"ok": False, "error": "ffmpeg install nahi hai"})
            FINAL.update(state="running", pct=0, msg="", file="", cancel=False)
            threading.Thread(target=final_worker, args=(body.get("project", {}), body.get("parts", {}), body.get("vparts", {})), daemon=True).start()
            self.send_json({"ok": True})
        elif path == "/api/final_cancel":
            FINAL["cancel"] = True
            self.send_json({"ok": True})
        else:
            self.send_error(404)


if __name__ == "__main__":
    ensure_motions_file()
    load_project(CUR[0])
    print(f"Root: {ROOT}\nProject: {CUR[0]}\nmotions.js: {MOTIONS_JS}\nOpen: http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()