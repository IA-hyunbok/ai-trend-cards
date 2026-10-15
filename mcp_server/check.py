"""MCP 서버 점검: stdio로 띄워 도구 목록과 호출 결과를 확인한다. 실행: python mcp_server/check.py"""
import asyncio
import json
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

SERVER = StdioServerParameters(command=sys.executable, args=[str(Path(__file__).with_name("server.py"))])


async def main():
    async with stdio_client(SERVER) as (read, write):
        async with ClientSession(read, write) as s:
            await s.initialize()
            names = sorted(t.name for t in (await s.list_tools()).tools)
            assert names == ["get_cards", "get_data_range", "get_summary"], names
            for name, args in [("get_summary", {}), ("get_data_range", {"start": "2026-07-10", "end": "2026-07-12"}),
                               ("get_cards", {})]:
                r = await s.call_tool(name, args)
                assert not r.is_error, r
                print(name, "→", json.dumps(r.structured_content or r.content[0].text, ensure_ascii=False)[:160])
    print("ok")


asyncio.run(main())
