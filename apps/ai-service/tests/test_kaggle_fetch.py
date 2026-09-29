import io
import zipfile
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _settings(username="testuser", key="testkey", dataset="gzipchrist/leetcode-problem-dataset"):
    s = MagicMock()
    s.kaggle_username = username
    s.kaggle_key = key
    s.kaggle_leetcode_dataset = dataset
    return s


def test_extract_first_csv_from_zip():
    from app.questions.kaggle import extract_first_csv
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("leetcode.csv", "title,url\nTwo Sum,https://leetcode.com/problems/two-sum/\n")
    out = extract_first_csv(buf.getvalue())
    assert "Two Sum" in out


def test_extract_first_csv_none_when_no_csv():
    from app.questions.kaggle import extract_first_csv
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("readme.txt", "x")
    assert extract_first_csv(buf.getvalue()) is None


def test_fetch_kaggle_csv_returns_none_when_no_credentials():
    import asyncio
    from app.questions.kaggle import fetch_kaggle_csv
    s = _settings(username="", key="")
    result = asyncio.run(fetch_kaggle_csv(s))
    assert result is None


def test_fetch_kaggle_csv_returns_none_on_http_error():
    import asyncio
    import httpx
    from app.questions.kaggle import fetch_kaggle_csv

    async def run():
        s = _settings()
        with patch("app.questions.kaggle.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get.side_effect = httpx.ConnectError("connection refused")
            return await fetch_kaggle_csv(s)

    result = asyncio.run(run())
    assert result is None
