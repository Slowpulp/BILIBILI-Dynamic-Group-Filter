"""Build the Chinese development guide PDF from its Markdown source.

The Markdown file is the single maintained content source. This renderer makes
the release PDF repeatably buildable without requiring a browser, Pandoc, or a
remote font/CDN. Mermaid flowcharts used by the guide are rendered as native
PDF vectors by a small, deliberately limited DAG renderer.
"""

from __future__ import annotations

import argparse
import html
import re
from collections import defaultdict, deque
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    HRFlowable,
    KeepTogether,
    ListFlowable,
    LongTable,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    XPreformatted,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "docs" / "DEVELOPMENT_GUIDE.zh-CN.md"
DEFAULT_OUTPUT = ROOT / "04_Deliverables" / "B站动态分组筛选-开发设计与演进指南.pdf"
PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT_MARGIN = 18 * mm
RIGHT_MARGIN = 18 * mm
TOP_MARGIN = 18 * mm
BOTTOM_MARGIN = 17 * mm
CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN

INK = HexColor("#14213D")
MUTED = HexColor("#5F6B7A")
PRIMARY = HexColor("#087EA4")
PRIMARY_DARK = HexColor("#075985")
CYAN = HexColor("#22D3EE")
VIOLET = HexColor("#7C3AED")
PINK = HexColor("#EC4899")
ORANGE = HexColor("#F97316")
PALE_BLUE = HexColor("#EAF8FC")
PALE_VIOLET = HexColor("#F2ECFF")
PALE_ORANGE = HexColor("#FFF3E8")
PAPER = HexColor("#F8FAFC")
GRID = HexColor("#CBD5E1")


def register_fonts() -> tuple[str, str, str]:
    regular = Path("C:/Windows/Fonts/msyh.ttc")
    bold = Path("C:/Windows/Fonts/msyhbd.ttc")
    mono = Path("C:/Windows/Fonts/consola.ttf")
    try:
        pdfmetrics.registerFont(TTFont("GuideBody", str(regular), subfontIndex=0))
        pdfmetrics.registerFont(TTFont("GuideBold", str(bold), subfontIndex=0))
        pdfmetrics.registerFont(TTFont("GuideMono", str(mono)))
        return "GuideBody", "GuideBold", "GuideMono"
    except Exception:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        return "STSong-Light", "STSong-Light", "Courier"


BODY_FONT, BOLD_FONT, MONO_FONT = register_fonts()


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    styles = {
        "Body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName=BODY_FONT,
            fontSize=9.4,
            leading=15.2,
            textColor=INK,
            spaceAfter=6,
            wordWrap="CJK",
            allowWidows=0,
            allowOrphans=0,
        ),
        "Heading1": ParagraphStyle(
            "Heading1",
            parent=base["Heading1"],
            fontName=BOLD_FONT,
            fontSize=20,
            leading=27,
            textColor=PRIMARY_DARK,
            spaceBefore=0,
            spaceAfter=13,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "Heading2": ParagraphStyle(
            "Heading2",
            parent=base["Heading2"],
            fontName=BOLD_FONT,
            fontSize=13.2,
            leading=19,
            textColor=VIOLET,
            spaceBefore=12,
            spaceAfter=7,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "Heading3": ParagraphStyle(
            "Heading3",
            parent=base["Heading3"],
            fontName=BOLD_FONT,
            fontSize=10.5,
            leading=16,
            textColor=PRIMARY,
            spaceBefore=9,
            spaceAfter=5,
            keepWithNext=True,
            wordWrap="CJK",
        ),
        "TOCTitle": ParagraphStyle(
            "TOCTitle",
            fontName=BOLD_FONT,
            fontSize=22,
            leading=28,
            textColor=PRIMARY_DARK,
            spaceAfter=16,
        ),
        "TOC0": ParagraphStyle(
            "TOC0",
            fontName=BODY_FONT,
            fontSize=10.2,
            leading=16,
            textColor=INK,
            leftIndent=0,
            firstLineIndent=0,
            spaceBefore=4,
        ),
        "TOC1": ParagraphStyle(
            "TOC1",
            fontName=BODY_FONT,
            fontSize=8.7,
            leading=13,
            textColor=MUTED,
            leftIndent=14,
            firstLineIndent=0,
        ),
        "Bullet": ParagraphStyle(
            "Bullet",
            parent=base["BodyText"],
            fontName=BODY_FONT,
            fontSize=9.2,
            leading=14.6,
            textColor=INK,
            leftIndent=0,
            wordWrap="CJK",
        ),
        "Code": ParagraphStyle(
            "Code",
            fontName=BODY_FONT,
            fontSize=7.6,
            leading=11.6,
            textColor=HexColor("#DDE7F0"),
            backColor=HexColor("#172033"),
            borderColor=HexColor("#26334A"),
            borderWidth=0.6,
            borderPadding=8,
            leftIndent=0,
            rightIndent=0,
            spaceBefore=4,
            spaceAfter=8,
            wordWrap="CJK",
        ),
        "Caption": ParagraphStyle(
            "Caption",
            fontName=BODY_FONT,
            fontSize=7.8,
            leading=11,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceBefore=3,
            spaceAfter=8,
        ),
        "Callout": ParagraphStyle(
            "Callout",
            fontName=BODY_FONT,
            fontSize=8.9,
            leading=14.2,
            textColor=PRIMARY_DARK,
            wordWrap="CJK",
        ),
        "TableHead": ParagraphStyle(
            "TableHead",
            fontName=BOLD_FONT,
            fontSize=8,
            leading=11,
            textColor=colors.white,
            alignment=TA_LEFT,
            wordWrap="CJK",
        ),
        "TableBody": ParagraphStyle(
            "TableBody",
            fontName=BODY_FONT,
            fontSize=7.65,
            leading=11.2,
            textColor=INK,
            wordWrap="CJK",
        ),
    }
    return styles


STYLES = make_styles()


def inline_markup(text: str) -> str:
    """Convert the small inline Markdown subset used in the guide."""

    tokens: list[str] = []

    def stash(value: str) -> str:
        token = f"@@MDTOKEN{len(tokens)}@@"
        tokens.append(value)
        return token

    def code_repl(match: re.Match[str]) -> str:
        value = html.escape(match.group(1))
        return stash(f'<font name="{BODY_FONT}" color="#075985">{value}</font>')

    def link_repl(match: re.Match[str]) -> str:
        label = html.escape(match.group(1))
        url = html.escape(match.group(2), quote=True)
        return stash(f'<link href="{url}" color="#087EA4"><u>{label}</u></link>')

    def auto_link_repl(match: re.Match[str]) -> str:
        url = html.escape(match.group(1), quote=True)
        return stash(f'<link href="{url}" color="#087EA4"><u>{url}</u></link>')

    value = re.sub(r"`([^`]+)`", code_repl, text)
    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link_repl, value)
    value = re.sub(r"<(https?://[^>]+)>", auto_link_repl, value)
    value = html.escape(value)
    value = re.sub(r"\*\*(.+?)\*\*", rf'<font name="{BOLD_FONT}">\1</font>', value)
    value = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", value)
    for index, replacement in enumerate(tokens):
        value = value.replace(f"@@MDTOKEN{index}@@", replacement)
    return value


def visible_length(value: str) -> int:
    plain = re.sub(r"[`*_\[\]()]", "", value)
    return sum(2 if ord(char) > 127 else 1 for char in plain)


def column_widths(rows: list[list[str]], total: float) -> list[float]:
    count = max(len(row) for row in rows)
    weights: list[float] = []
    for index in range(count):
        lengths = [visible_length(row[index]) if index < len(row) else 0 for row in rows]
        weights.append(max(8, min(42, max(lengths, default=8))))
    minimum = 42.0
    widths = [max(minimum, total * weight / sum(weights)) for weight in weights]
    overflow = sum(widths) - total
    if overflow > 0:
        flexible = [max(0.0, width - minimum) for width in widths]
        pool = sum(flexible)
        if pool:
            widths = [width - overflow * room / pool for width, room in zip(widths, flexible)]
    scale = total / sum(widths)
    return [width * scale for width in widths]


def markdown_table(rows: list[list[str]]) -> LongTable:
    width = CONTENT_WIDTH
    normalized = [row + [""] * (max(map(len, rows)) - len(row)) for row in rows]
    data = []
    for row_index, row in enumerate(normalized):
        style = STYLES["TableHead"] if row_index == 0 else STYLES["TableBody"]
        data.append([Paragraph(inline_markup(cell.strip()), style) for cell in row])
    table = LongTable(
        data,
        colWidths=column_widths(normalized, width),
        repeatRows=1,
        hAlign="LEFT",
        splitByRow=1,
    )
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.35, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for row_index in range(1, len(data)):
        if row_index % 2 == 0:
            commands.append(("BACKGROUND", (0, row_index), (-1, row_index), PAPER))
    table.setStyle(TableStyle(commands))
    return table


def split_label(label: str, width: float, font_size: float) -> list[str]:
    label = label.replace("<br/>", "\n").replace("<br>", "\n")
    output: list[str] = []
    for source_line in label.splitlines() or [label]:
        current = ""
        for char in source_line:
            candidate = current + char
            if current and pdfmetrics.stringWidth(candidate, BOLD_FONT, font_size) > width:
                output.append(current)
                current = char
            else:
                current = candidate
        if current:
            output.append(current)
    return output[:4] or [""]


class MermaidFlowchart(Flowable):
    """Render the guide's intentionally simple Mermaid DAGs as PDF vectors."""

    node_pattern = re.compile(r'^\s*([A-Za-z0-9_]+)\s*\["(.*?)"\]\s*$')
    edge_pattern = re.compile(r"^\s*([A-Za-z0-9_]+)\s*-->\s*([A-Za-z0-9_]+)\s*$")

    def __init__(self, source: str, max_width: float = CONTENT_WIDTH):
        super().__init__()
        self.source = source
        self.max_width = max_width
        self.nodes: dict[str, str] = {}
        self.edges: list[tuple[str, str]] = []
        self.direction = "TB"
        self._parse()
        self.layers = self._layers()
        if len(self.layers) >= 6:
            # Long vertical pipelines stay readable without consuming an
            # otherwise nearly empty full page.
            self.node_height = 37.0
            self.v_gap = 22.0
            self.top_pad = 14.0
            self.bottom_pad = 14.0
        else:
            self.node_height = 43.0
            self.v_gap = 34.0
            self.top_pad = 18.0
            self.bottom_pad = 16.0
        self.width = max_width
        self.height = (
            self.top_pad
            + len(self.layers) * self.node_height
            + max(0, len(self.layers) - 1) * self.v_gap
            + self.bottom_pad
        )

    def _parse(self) -> None:
        for raw_line in self.source.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("%%"):
                continue
            if line.startswith("flowchart"):
                parts = line.split()
                if len(parts) > 1:
                    self.direction = parts[1]
                continue
            node = self.node_pattern.match(line)
            if node:
                self.nodes[node.group(1)] = node.group(2)
                continue
            edge = self.edge_pattern.match(line)
            if edge:
                self.edges.append((edge.group(1), edge.group(2)))
                self.nodes.setdefault(edge.group(1), edge.group(1))
                self.nodes.setdefault(edge.group(2), edge.group(2))
        if not self.nodes:
            self.nodes = {"EMPTY": "无法解析图表"}

    def _layers(self) -> list[list[str]]:
        incoming = {node: 0 for node in self.nodes}
        outgoing: dict[str, list[str]] = defaultdict(list)
        for source, target in self.edges:
            outgoing[source].append(target)
            incoming[target] = incoming.get(target, 0) + 1
        queue = deque(node for node in self.nodes if incoming.get(node, 0) == 0)
        depth = {node: 0 for node in queue}
        visited = set()
        while queue:
            node = queue.popleft()
            visited.add(node)
            for target in outgoing.get(node, []):
                depth[target] = max(depth.get(target, 0), depth[node] + 1)
                incoming[target] -= 1
                if incoming[target] == 0:
                    queue.append(target)
        for node in self.nodes:
            if node not in visited:
                depth.setdefault(node, max(depth.values(), default=0) + 1)
        grouped: dict[int, list[str]] = defaultdict(list)
        for node in self.nodes:
            grouped[depth.get(node, 0)].append(node)
        return [grouped[level] for level in sorted(grouped)]

    def wrap(self, available_width: float, available_height: float) -> tuple[float, float]:
        return min(available_width, self.width), self.height

    def draw(self) -> None:
        canvas = self.canv
        layer_positions: dict[str, tuple[float, float, float, float]] = {}
        max_nodes = max(len(layer) for layer in self.layers)
        gap = 10.0
        node_width = min(142.0, (self.width - gap * (max_nodes + 1)) / max_nodes)
        node_width = max(66.0, node_width)
        for layer_index, layer in enumerate(self.layers):
            total_width = len(layer) * node_width + max(0, len(layer) - 1) * gap
            start_x = (self.width - total_width) / 2
            y = self.height - self.top_pad - self.node_height - layer_index * (self.node_height + self.v_gap)
            for node_index, node in enumerate(layer):
                x = start_x + node_index * (node_width + gap)
                layer_positions[node] = (x, y, node_width, self.node_height)

        canvas.saveState()
        canvas.setStrokeColor(HexColor("#94A3B8"))
        canvas.setLineWidth(0.9)
        for source, target in self.edges:
            if source not in layer_positions or target not in layer_positions:
                continue
            sx, sy, sw, _ = layer_positions[source]
            tx, ty, tw, th = layer_positions[target]
            start_x = sx + sw / 2
            start_y = sy
            end_x = tx + tw / 2
            end_y = ty + th
            mid_y = (start_y + end_y) / 2
            canvas.line(start_x, start_y, start_x, mid_y)
            canvas.line(start_x, mid_y, end_x, mid_y)
            canvas.line(end_x, mid_y, end_x, end_y + 4)
            canvas.setFillColor(HexColor("#64748B"))
            canvas.drawPath(
                _triangle_path(canvas, end_x, end_y, 4.2),
                fill=1,
                stroke=0,
            )

        fills = [PALE_BLUE, PALE_VIOLET, PALE_ORANGE, HexColor("#FCE7F3")]
        strokes = [PRIMARY, VIOLET, ORANGE, PINK]
        for index, node in enumerate(self.nodes):
            x, y, width, height = layer_positions[node]
            canvas.setFillColor(fills[index % len(fills)])
            canvas.setStrokeColor(strokes[index % len(strokes)])
            canvas.setLineWidth(1.0)
            canvas.roundRect(x, y, width, height, 7, fill=1, stroke=1)
            font_size = 7.9 if width < 90 else 8.4
            lines = split_label(self.nodes[node], width - 12, font_size)
            line_height = font_size + 2.2
            block_height = len(lines) * line_height
            text_y = y + (height + block_height) / 2 - line_height + 1
            canvas.setFillColor(INK)
            canvas.setFont(BOLD_FONT, font_size)
            for line in lines:
                canvas.drawCentredString(x + width / 2, text_y, line)
                text_y -= line_height
        canvas.restoreState()


def _triangle_path(canvas, center_x: float, tip_y: float, size: float):
    path = canvas.beginPath()
    path.moveTo(center_x, tip_y)
    path.lineTo(center_x - size, tip_y + size + 1)
    path.lineTo(center_x + size, tip_y + size + 1)
    path.close()
    return path


class CoverPage(Flowable):
    def __init__(self, width: float, height: float, metadata: dict[str, str]):
        super().__init__()
        self.width = width
        self.height = height
        self.metadata = metadata

    def wrap(self, available_width: float, available_height: float) -> tuple[float, float]:
        self.width = available_width
        self.height = available_height
        return available_width, available_height

    def draw(self) -> None:
        canvas = self.canv
        width, height = self.width, self.height
        canvas.saveState()
        canvas.setFillColor(HexColor("#071B33"))
        canvas.roundRect(0, height - 242, width, 242, 18, fill=1, stroke=0)
        bands = [(CYAN, 0.0), (PRIMARY, 0.25), (VIOLET, 0.5), (PINK, 0.75)]
        for color, ratio in bands:
            canvas.setFillColor(color)
            canvas.rect(width * ratio, height - 8, width * 0.25 + 1, 8, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont(BOLD_FONT, 25)
        canvas.drawString(25, height - 70, "B站动态分组筛选")
        canvas.setFont(BOLD_FONT, 18)
        canvas.drawString(25, height - 105, "开发设计与演进指南")
        canvas.setFillColor(HexColor("#BAE6FD"))
        canvas.setFont(BODY_FONT, 10)
        canvas.drawString(25, height - 137, "从 DOM 适配、规则系统到 SPA 韧性与版本化发布")
        canvas.setFillColor(HexColor("#E2E8F0"))
        canvas.setFont(BODY_FONT, 8.7)
        canvas.drawString(
            25,
            height - 174,
            f"文档版 {self.metadata['document_version']}    "
            f"对应脚本 {self.metadata['script_version']}    "
            f"{self.metadata['date']}",
        )

        chips = [
            ("默认放行", PALE_BLUE, PRIMARY_DARK),
            ("可解释规则", PALE_VIOLET, VIOLET),
            ("本地优先", PALE_ORANGE, ORANGE),
            ("可回滚发布", HexColor("#FCE7F3"), PINK),
        ]
        chip_y = height - 290
        chip_width = (width - 45) / 4
        for index, (label, fill, stroke) in enumerate(chips):
            x = index * (chip_width + 15)
            canvas.setFillColor(fill)
            canvas.setStrokeColor(stroke)
            canvas.roundRect(x, chip_y, chip_width, 32, 9, fill=1, stroke=1)
            canvas.setFillColor(stroke)
            canvas.setFont(BOLD_FONT, 8.6)
            canvas.drawCentredString(x + chip_width / 2, chip_y + 11, label)

        canvas.setFillColor(INK)
        canvas.setFont(BOLD_FONT, 12.5)
        canvas.drawString(0, height - 355, "这份指南帮助你学会")
        items = [
            "把不稳定网页 DOM 翻译成稳定领域模型",
            "用多信号、负例和置信度控制内容误伤",
            "处理无限滚动、虚拟列表、账号切换与异步竞态",
            "建立从测试、构建到 GitHub Release 的完整交付链",
        ]
        canvas.setFont(BODY_FONT, 10)
        y = height - 388
        for item in items:
            canvas.setFillColor(PRIMARY)
            canvas.circle(6, y + 3, 2.6, fill=1, stroke=0)
            canvas.setFillColor(INK)
            canvas.drawString(18, y, item)
            y -= 30

        canvas.setFillColor(PAPER)
        canvas.setStrokeColor(GRID)
        canvas.roundRect(0, 34, width, 102, 12, fill=1, stroke=1)
        canvas.setFillColor(MUTED)
        canvas.setFont(BODY_FONT, 8.7)
        summary = [
            "维护源: docs/DEVELOPMENT_GUIDE.zh-CN.md",
            "分析对象: src、test、CHANGELOG、README 与 Git 标签",
            "事实边界: 真实登录、扩展安装和定时更新仍需人工验收",
        ]
        sy = 106
        for line in summary:
            canvas.drawString(18, sy, line)
            sy -= 25
        canvas.restoreState()


class GuideDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=LEFT_MARGIN,
            rightMargin=RIGHT_MARGIN,
            topMargin=TOP_MARGIN,
            bottomMargin=BOTTOM_MARGIN,
            title="B站动态分组筛选: 开发设计与演进指南",
            author="BILIBILI Dynamic Group Filter Project",
            subject="用户脚本架构、规则系统、稳定性、测试与版本演进",
        )
        cover_frame = Frame(
            LEFT_MARGIN,
            BOTTOM_MARGIN,
            CONTENT_WIDTH,
            PAGE_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN,
            id="cover-frame",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        body_frame = Frame(
            LEFT_MARGIN,
            BOTTOM_MARGIN,
            CONTENT_WIDTH,
            PAGE_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN,
            id="body-frame",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates([
            PageTemplate(id="Cover", frames=[cover_frame], onPage=draw_cover_page),
            PageTemplate(id="Body", frames=[body_frame], onPage=draw_body_page),
        ])
        self._bookmark_counter = 0

    def beforeDocument(self) -> None:
        super().beforeDocument()
        # multiBuild performs more than one pass for the table of contents.
        # Stable bookmark keys are required for the index to converge.
        self._bookmark_counter = 0

    def afterFlowable(self, flowable: Flowable) -> None:
        if not isinstance(flowable, Paragraph):
            return
        style_name = flowable.style.name
        if style_name not in {"Heading1", "Heading2", "Heading3"}:
            return
        level = {"Heading1": 0, "Heading2": 1, "Heading3": 2}[style_name]
        text = flowable.getPlainText()
        key = f"heading-{self._bookmark_counter}"
        self._bookmark_counter += 1
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level, closed=False)
        self.notify("TOCEntry", (level, text, self.page, key))


def draw_cover_page(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFillColor(colors.white)
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    canvas.setTitle("B站动态分组筛选: 开发设计与演进指南")
    canvas.setAuthor("BILIBILI Dynamic Group Filter Project")
    canvas.restoreState()


def draw_body_page(canvas, doc) -> None:
    canvas.saveState()
    page = canvas.getPageNumber() - 1
    canvas.setStrokeColor(GRID)
    canvas.setLineWidth(0.45)
    canvas.line(LEFT_MARGIN, PAGE_HEIGHT - 12 * mm, PAGE_WIDTH - RIGHT_MARGIN, PAGE_HEIGHT - 12 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont(BODY_FONT, 7.4)
    canvas.drawString(LEFT_MARGIN, PAGE_HEIGHT - 9.5 * mm, "B站动态分组筛选 · 开发设计与演进指南")
    canvas.drawRightString(PAGE_WIDTH - RIGHT_MARGIN, 9.5 * mm, f"{page}")
    canvas.setFillColor(PRIMARY)
    canvas.rect(LEFT_MARGIN, 7.3 * mm, 18 * mm, 1.2, fill=1, stroke=0)
    canvas.restoreState()


def paragraph_box(text: str) -> Table:
    table = Table([[Paragraph(inline_markup(text), STYLES["Callout"])]], colWidths=[CONTENT_WIDTH])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_BLUE),
        ("BOX", (0, 0), (-1, -1), 0.6, HexColor("#7DD3FC")),
        ("LINEBEFORE", (0, 0), (0, -1), 3, PRIMARY),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def wrap_code_block(code: str, limit: int = 92) -> str:
    wrapped: list[str] = []
    for line in code.splitlines():
        if len(line) <= limit:
            wrapped.append(line)
            continue
        indent = re.match(r"^\s*", line).group(0)
        remaining = line
        while len(remaining) > limit:
            split_at = remaining.rfind(" ", 0, limit + 1)
            if split_at <= len(indent):
                split_at = limit
            wrapped.append(remaining[:split_at].rstrip())
            remaining = indent + "  " + remaining[split_at:].lstrip()
        wrapped.append(remaining)
    return "\n".join(wrapped)


def parse_markdown(source: str) -> list[Flowable]:
    lines = source.splitlines()
    story: list[Flowable] = []
    paragraph_lines: list[str] = []
    major_count = 0
    figure_count = 0
    index = 0

    # Title and metadata are represented by the PDF cover. Start after the
    # first horizontal rule so the Markdown remains the single semantic source.
    while index < len(lines) and lines[index].strip() != "---":
        index += 1
    if index < len(lines):
        index += 1

    def flush_paragraph() -> None:
        nonlocal paragraph_lines
        if paragraph_lines:
            text = " ".join(line.strip() for line in paragraph_lines).strip()
            if text:
                story.append(Paragraph(inline_markup(text), STYLES["Body"]))
            paragraph_lines = []

    while index < len(lines):
        raw = lines[index]
        stripped = raw.strip()

        if not stripped:
            flush_paragraph()
            index += 1
            continue

        if stripped.startswith("```"):
            flush_paragraph()
            language = stripped[3:].strip().lower()
            index += 1
            block: list[str] = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                block.append(lines[index])
                index += 1
            index += 1
            if language == "mermaid":
                figure_count += 1
                diagram = MermaidFlowchart("\n".join(block))
                diagram.keepWithNext = True
                story.extend([
                    diagram,
                    Paragraph(f"图 {figure_count} · 项目设计关系图", STYLES["Caption"]),
                ])
            else:
                code = "\n".join(block).replace("\t", "    ")
                story.append(KeepTogether([
                    XPreformatted(html.escape(wrap_code_block(code)), STYLES["Code"]),
                ]))
            continue

        heading = re.match(r"^(#{2,4})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            hashes, title = heading.groups()
            if len(hashes) == 2:
                if major_count == 1:
                    story.append(PageBreak())
                elif major_count > 1:
                    story.append(CondPageBreak(55 * mm))
                major_count += 1
                story.append(Paragraph(inline_markup(title), STYLES["Heading1"]))
                rule = HRFlowable(width="100%", thickness=1.2, color=CYAN, spaceAfter=9)
                rule.keepWithNext = True
                story.append(rule)
            elif len(hashes) == 3:
                story.append(Paragraph(inline_markup(title), STYLES["Heading2"]))
            else:
                story.append(Paragraph(inline_markup(title), STYLES["Heading3"]))
            index += 1
            continue

        if stripped == "---":
            flush_paragraph()
            story.append(HRFlowable(width="100%", thickness=0.6, color=GRID, spaceBefore=5, spaceAfter=8))
            index += 1
            continue

        if stripped == "<!-- pdf-pagebreak -->":
            flush_paragraph()
            story.append(PageBreak())
            index += 1
            continue

        if stripped.startswith(">"):
            flush_paragraph()
            quote_lines = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quote_lines.append(lines[index].strip().lstrip(">").strip())
                index += 1
            story.extend([paragraph_box(" ".join(quote_lines)), Spacer(1, 7)])
            continue

        if stripped.startswith("|") and index + 1 < len(lines) and re.match(r"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$", lines[index + 1]):
            flush_paragraph()
            table_lines = [lines[index]]
            index += 2  # Skip separator.
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index])
                index += 1
            rows = [line.strip().strip("|").split("|") for line in table_lines]
            story.extend([markdown_table(rows), Spacer(1, 8)])
            continue

        unordered = re.match(r"^[-*]\s+(.+)$", stripped)
        ordered = re.match(r"^\d+[.)]\s+(.+)$", stripped)
        if unordered or ordered:
            flush_paragraph()
            ordered_list = bool(ordered)
            items: list[Paragraph] = []
            pattern = r"^\d+[.)]\s+(.+)$" if ordered_list else r"^[-*]\s+(.+)$"
            while index < len(lines):
                match = re.match(pattern, lines[index].strip())
                if not match:
                    break
                items.append(Paragraph(inline_markup(match.group(1)), STYLES["Bullet"]))
                index += 1
            story.append(ListFlowable(
                items,
                bulletType="1" if ordered_list else "bullet",
                start=1 if ordered_list else "•",
                bulletFontName=BODY_FONT,
                bulletFontSize=8.5,
                bulletColor=PRIMARY,
                leftIndent=19,
                bulletIndent=5,
                spaceAfter=7,
            ))
            continue

        paragraph_lines.append(raw)
        index += 1

    flush_paragraph()
    block_types = (LongTable, MermaidFlowchart, KeepTogether)
    for position, flowable in enumerate(story[:-1]):
        following = story[position + 1]
        if (
            isinstance(flowable, Paragraph)
            and flowable.style.name == "Body"
            and isinstance(following, block_types)
        ):
            flowable.keepWithNext = True
    return story


def extract_cover_metadata(source: str) -> dict[str, str]:
    fields = {
        "document_version": r"^> 文档版本:\s*(.+?)\s*$",
        "script_version": r"^> 对应脚本版本:\s*(.+?)\s*$",
        "date": r"^> 编写日期:\s*(.+?)\s*$",
    }
    metadata: dict[str, str] = {}
    for name, pattern in fields.items():
        match = re.search(pattern, source, re.MULTILINE)
        if not match:
            raise ValueError(f"Missing cover metadata field: {name}")
        metadata[name] = match.group(1).strip()
    return metadata


def build(source_path: Path, output_path: Path) -> None:
    source = source_path.read_text(encoding="utf-8")
    metadata = extract_cover_metadata(source)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = GuideDocTemplate(str(output_path))
    toc = TableOfContents()
    toc.levelStyles = [STYLES["TOC0"], STYLES["TOC1"], STYLES["TOC1"]]
    toc.dotsMinLevel = 0
    story: list[Flowable] = [
        CoverPage(CONTENT_WIDTH, PAGE_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN, metadata),
        NextPageTemplate("Body"),
        PageBreak(),
        Paragraph("目录", STYLES["TOCTitle"]),
        Paragraph("章节页码会在构建时自动更新。", STYLES["Body"]),
        Spacer(1, 8),
        toc,
        PageBreak(),
    ]
    story.extend(parse_markdown(source))
    doc.multiBuild(story)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build(args.source.resolve(), args.output.resolve())
    print(args.output.resolve())


if __name__ == "__main__":
    main()
