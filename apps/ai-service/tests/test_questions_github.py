import io, tarfile
from app.questions.github import parse_tarball


def _make_tar(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, body in files.items():
            info = tarfile.TarInfo(name=name)
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))
    return buf.getvalue()


def test_parse_tarball_strips_top_level_dir():
    # codeload tarballs wrap everything in "<repo>-<ref>/"
    data = _make_tar({"repo-master/google/All.csv": b"a,b\n1,2\n",
                      "repo-master/README.md": b"hi"})
    out = parse_tarball(data)
    assert "google/All.csv" in out
    assert out["google/All.csv"] == b"a,b\n1,2\n"
    assert "README.md" in out


def test_parse_tarball_skips_directories():
    data = _make_tar({"repo-master/dir/": b"", "repo-master/dir/f.txt": b"x"})
    out = parse_tarball(data)
    assert "dir/f.txt" in out
    assert all(not k.endswith("/") for k in out)
