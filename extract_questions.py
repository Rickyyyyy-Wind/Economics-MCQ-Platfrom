# ========================================================
# A2 Economics MCQ - PDF Question Extraction Pipeline
# Extracts questions + answers + diagram images from
# Cambridge past papers (QP + MS PDF pairs)
# ========================================================

import fitz  # PyMuPDF
import json
import os
import re
import sys
from pathlib import Path

# ========================================================
# CONFIGURATION
# ========================================================

# Cambridge chapter classification: map keywords/themes to chapter numbers
# These are based on the official Cambridge A Level Economics syllabus
CHAPTER_RULES = [
    # Format: (chapter_num, [keywords], label)
    (30, ["marginal utility", "total utility", "utility theory", "diminishing marginal utility"], "Utility"),
    (31, ["indifference curve", "budget line", "indifference", "income effect", "substitution effect",
          "price consumption", "income consumption", "engel curve", "giffen good", "inferior good",
          "pareto improvement", "pareto", "consumer equilibrium", "MRS", "marginal rate of substitution"], "Indifference curves and budget lines"),
    (32, ["market failure", "efficiency", "allocative efficiency", "productive efficiency",
          "dynamic efficiency", "pareto efficiency", "public good", "non-excludable", "non-rival",
          "information failure", "merit good", "demerit good", "deadweight loss"], "Efficiency and market failure"),
    (33, ["external cost", "external benefit", "externality", "social cost", "social benefit",
          "private cost", "private benefit", "MSC", "MSB", "MPC", "MPB", "negative externality",
          "positive externality", "spillover"], "Private costs and benefits, externalities"),
    (34, ["cost", "revenue", "profit", "short-run", "long-run", "production", "average cost",
          "marginal cost", "total cost", "fixed cost", "variable cost", "average revenue",
          "marginal revenue", "total revenue", "economies of scale", "diseconomies",
          "LRAC", "SRAC", "returns to scale", "diminishing returns", "AVC", "ATC",
          "shut down", "short run", "long run", "average variable cost", "average total cost"], "Types of cost, revenue and profit, production"),
    (35, ["market structure", "perfect competition", "monopoly", "monopolistic", "oligopoly",
          "contestable", "price taker", "price maker", "barrier to entry", "market power",
          "kinked demand", "game theory", "prisoner", "dominant firm", "price discrimination",
          "concentration ratio", "N-firm", "natural monopoly", "supernormal profit", "normal profit",
          "monopsony"], "Different market structures"),
    (36, ["growth", "firm", "survival", "merger", "takeover", "acquisition", "integration",
          "horizontal integration", "vertical integration", "conglomerate", "divorce of ownership",
          "principal agent", "profit maximisation", "revenue maximisation", "sales maximisation",
          "satisficing", "corporate social responsibility", "CSR", "objective of firm",
          "divorce", "ownership", "control", "managerial"], "Growth and survival of firms"),
    (38, ["government policy", "efficient resource allocation", "correct market failure",
          "regulation", "tax", "subsidy", "price control", "maximum price", "minimum price",
          "buffer stock", "tradable permit", "nudge", "nationalisation", "privatisation",
          "public provision", "government intervention", "indirect tax", "specific tax",
          "ad valorem", "pollution permit", "carbon tax", "price ceiling", "price floor",
          "minimum wage", "government failure"], "Government policies and market failure correction"),
    (39, ["equity", "redistribution", "income", "wealth", "inequality", "gini", "lorenz",
          "poverty", "absolute poverty", "relative poverty", "universal basic income",
          "negative income tax", "progressive tax", "regressive tax", "proportional tax",
          "transfer payment", "means-tested", "pension", "benefit"], "Equity and redistribution of income and wealth"),
    (40, ["labour market", "labour", "wage", "wage differential", "trade union",
          "collective bargaining", "monopsony", "minimum wage", "MRP", "marginal revenue product",
          "marginal physical product", "derived demand", "elasticity of labour demand",
          "elasticity of labour supply", "human capital", "discrimination", "mobility of labour",
          "geographical immobility", "occupational immobility", "backward-bending",
          "income effect labour", "substitution effect labour", "ACL", "MCL"], "Labour market forces and government intervention"),
    (41, ["circular flow", "injection", "withdrawal", "leakage", "national income",
          "aggregate demand", "AD", "aggregate supply", "AS", "macroeconomic equilibrium",
          "multiplier", "accelerator", "MPC", "MPS", "MPT", "MPM", "marginal propensity",
          "GDP", "GNP", "national output", "expenditure", "income flow"], "The circular flow of income"),
    (42, ["economic growth", "sustainability", "sustainable development", "GDP growth",
          "actual growth", "potential growth", "output gap", "recession", "boom",
          "economic cycle", "trend growth", "supply-side policy", "PPF", "production possibility",
          "inclusive growth", "green growth"], "Economic growth and sustainability"),
    (43, ["unemployment", "employment", "job", "cyclical unemployment", "structural unemployment",
          "frictional unemployment", "seasonal unemployment", "NAIRU", "natural rate",
          "full employment", "claimant count", "labour force survey", "ILO",
          "underemployment", "disguised unemployment", "real wage unemployment",
          "demand-deficient unemployment", "Phillips", "phillips curve"], "Employment and unemployment"),
    (44, ["money", "banking", "central bank", "interest rate", "monetary policy", "money supply",
          "commercial bank", "liquidity", "fractional reserve", "credit creation",
          "quantitative easing", "QE", "base rate", "reserve requirement", "broad money",
          "narrow money", "M0", "M4", "financial sector", "lender of last resort",
          "financial crisis"], "Money and banking"),
    (45, ["macroeconomic policy", "objective", "inflation", "price stability", "CPI",
          "RPI", "demand-pull inflation", "cost-push inflation", "deflation",
          "disinflation", "hyperinflation", "monetary policy committee", "MPC",
          "fiscal policy", "government spending", "taxation policy", "balanced budget",
          "budget deficit", "budget surplus", "national debt", "austerity",
          "supply-side", "macroeconomic objective"], "Government macroeconomic policy objectives"),
    (46, ["interrelated", "macroeconomic problem", "conflict", "trade-off", "policy conflict",
          "unemployment inflation", "growth inflation", "current account",
          "balance of payments deficit", "phillips curve trade-off", "stagflation",
          "misery index", "macroeconomic performance"], "Links between macroeconomic problems"),
    (47, ["effectiveness", "policy option", "macroeconomic objective", "fiscal policy effectiveness",
          "monetary policy effectiveness", "supply-side effectiveness", "policy evaluation",
          "policy conflict", "time lag", "crowding out", "liquidity trap",
          "zero lower bound", "ZLB"], "Effectiveness of policy options"),
    (48, ["disequilibrium", "balance of payments", "current account deficit", "current account surplus",
          "BOP", "trade deficit", "trade surplus", "expenditure-switching",
          "expenditure-reducing", "devaluation", "depreciation", "protectionism",
          "tariff", "quota", "export subsidy", "import control",
          "marshall-lerner", "J-curve"], "Policies to correct disequilibrium in the balance of payments"),
    (49, ["exchange rate", "floating", "fixed", "managed float", "appreciation",
          "depreciation", "devaluation", "revaluation", "foreign exchange market",
          "purchasing power parity", "PPP", "hot money", "speculation",
          "currency", "forex", "ERM", "exchange rate mechanism",
          "competitive devaluation", "currency war"], "Exchange rates"),
    (50, ["economic development", "development", "HDI", "human development",
          "developing country", "less developed", "LDC", "newly industrialised",
          "NIC", "emerging economy", "Millennium Development", "MDG",
          "Sustainable Development Goal", "SDG", "poverty trap", "vicious cycle",
          "infrastructure", "industrialisation", "structural change", "Lewis model",
          "dual economy", "Harrod-Domar", "Rostow"], "Economic development"),
    (51, ["characteristics", "level of development", "low income", "middle income",
          "high income", "developing", "developed", "emerging",
          "population growth", "demographic", "dependency ratio", "primary sector",
          "agriculture", "manufacturing", "tertiary", "service sector",
          "informal economy", "subsistence"], "Characteristics of countries at different levels of development"),
    (52, ["relationship between countries", "trade", "globalisation", "FDI", "foreign direct investment",
          "multinational", "MNC", "TNC", "transnational", "outsourcing",
          "technology transfer", "aid", "development aid", "bilateral aid",
          "multilateral aid", "tied aid", "World Bank", "IMF",
          "WTO", "debt relief", "HIPC", "microfinance"], "Relationships between countries at different levels of development"),
    (53, ["globalisation", "global", "international trade", "trade liberalisation",
          "free trade", "comparative advantage", "absolute advantage", "terms of trade",
          "trade bloc", "customs union", "single market", "monetary union",
          "EU", "NAFTA", "ASEAN", "protectionism", "tariff", "quota",
          "regional trade agreement", "RTA", "WTO", "global supply chain",
          "offshoring"], "Globalisation"),
]


def classify_question(text, question_num, paper_session):
    """Classify a question into chapters based on keyword matching against economic theory."""
    text_lower = text.lower()
    chapter_scores = []

    # Prefer specific concept matches over broad single-word matches.
    broad_terms = {
        "growth", "firm", "market", "cost", "policy", "money", "trade", "income",
        "equity", "efficiency", "development", "wage", "price", "value"
    }

    for ch_num, keywords, label in CHAPTER_RULES:
        score = 0
        for kw in keywords:
            kw_lower = kw.lower()
            if kw_lower not in text_lower:
                continue

            occurrences = len(re.findall(re.escape(kw_lower), text_lower))
            if occurrences == 0:
                continue

            weight = 1
            if " " in kw_lower or len(kw_lower) >= 10:
                weight += 2
            if kw_lower in broad_terms:
                weight -= 1
            if kw_upper := kw.upper():
                if kw_upper in {"MRS", "MSC", "MSB", "MPC", "MPB", "LRAC", "SRAC", "AVC", "ATC", "MRPL", "NAIRU", "HDI"}:
                    weight += 2
            score += max(1, weight) * occurrences

        if score > 0:
            chapter_scores.append((score, ch_num))

    if not chapter_scores:
        return []

    chapter_scores.sort(key=lambda item: (-item[0], item[1]))
    top_score = chapter_scores[0][0]

    # Keep only the strongest 1-2 chapters so weakly related matches do not leak in.
    selected = [ch for score, ch in chapter_scores if score >= max(2, top_score - 1)]
    if not selected:
        selected = [chapter_scores[0][1]]

    return selected[:2]


def parse_mark_scheme(ms_path):
    """Extract answer key from mark scheme PDF."""
    doc = fitz.open(ms_path)
    answers = {}

    for page in doc:
        text = page.get_text("text")
        # Match lines like: "1  C  1" or "1 C 1" (question number, answer letter, marks)
        for match in re.finditer(r'^\s*(\d{1,2})\s+([ABCD])\s+\d', text, re.MULTILINE):
            q_num = int(match.group(1))
            answer = match.group(2)
            answers[q_num] = answer

    doc.close()
    return answers


def extract_question_text(page, question_num):
    """Extract the full question text for a given question number from a page."""
    text = page.get_text("text")

    # Find the question boundary
    # Pattern: question number followed by text, then next question number or end
    pattern = rf'(\b{question_num}\b\s+.+?)(?=\n\s*\d{{1,2}}\s+\n|\n\s*\d{{1,2}}\s+[A-Z]|\Z)'
    match = re.search(pattern, text, re.DOTALL)

    if match:
        return match.group(1).strip()
    return None


def extract_question_options(text):
    """Split question text into stem and options A/B/C/D."""
    # Remove leading question number
    text = re.sub(r'^\s*\d+\s+', '', text)

    options = {}
    # Match options: "A option text" up to next option or end
    option_pattern = r'([ABCD])\s+(.+?)(?=\s+[ABCD]\s+|\Z)'
    option_matches = list(re.finditer(option_pattern, text, re.DOTALL))

    stem = text
    if option_matches:
        first_option_start = option_matches[0].start()
        stem = text[:first_option_start].strip()

    for match in option_matches:
        letter = match.group(1)
        option_text = match.group(2).strip()
        # Clean up: join broken lines, remove extra whitespace
        option_text = re.sub(r'\s+', ' ', option_text)
        options[letter] = option_text

    return stem, options


def has_diagram(page, question_num):
    """Check if a question has an associated diagram/image on the page."""
    # Check for embedded images in the question area
    blocks = page.get_text("dict")["blocks"]
    has_image = False

    # Get question text position
    text_blocks = [b for b in blocks if b["type"] == 0]
    image_blocks = [b for b in blocks if b["type"] == 1]

    if not image_blocks:
        return False

    # Find the text block containing our question
    q_text = f"\n{question_num}\n" if question_num >= 10 else f"\n{question_num} "
    q_block_idx = None

    for i, block in enumerate(text_blocks):
        block_text = ""
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                block_text += span.get("text", "")
        if str(question_num) in block_text.split()[:3]:
            q_block_idx = i
            break

    if q_block_idx is None:
        return False

    # Check if any image appears near this question's text block
    q_bbox = text_blocks[q_block_idx]["bbox"]
    for img_block in image_blocks:
        img_bbox = img_block["bbox"]
        # Image is near if it's on the same page area as the question
        y_overlap = (img_bbox[1] >= q_bbox[1] - 50 and img_bbox[1] <= q_bbox[3] + 200)
        if y_overlap:
            has_image = True
            break

    return has_image


def extract_question_image(page, question_num, output_dir, paper_id):
    """Extract the question stem + diagram as a high-resolution image."""
    # Render the page at high DPI
    zoom = 2.5  # High DPI for quality
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)

    # Get the question's bounding box on the page
    blocks = page.get_text("dict")["blocks"]
    text_blocks = [b for b in blocks if b["type"] == 0]

    # Find our question's text position
    q_y_top = None
    q_y_bottom = None

    for i, block in enumerate(text_blocks):
        block_text = ""
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                block_text += span.get("text", "")
        words = block_text.split()
        if words and words[0].rstrip('.') == str(question_num):
            q_y_top = block["bbox"][1]
            # Find next question's start or page end
            next_q = question_num + 1
            for j in range(i + 1, len(text_blocks)):
                next_text = ""
                for line in text_blocks[j].get("lines", []):
                    for span in line.get("spans", []):
                        next_text += span.get("text", "")
                next_words = next_text.split()
                if next_words and next_words[0].rstrip('.') == str(next_q):
                    q_y_bottom = text_blocks[j]["bbox"][1] - 10
                    break
            if q_y_bottom is None:
                q_y_bottom = page.rect.height - 40
            break

    if q_y_top is None:
        # Fallback: extract full page
        img_path = os.path.join(output_dir, f"{paper_id}_q{question_num:02d}.png")
        pix.save(img_path)
        return img_path

    # Crop region: question top to options start (or a reasonable bottom)
    # Add padding
    padding = 20
    y1 = max(0, q_y_top - padding)
    y2 = min(page.rect.height, q_y_bottom + padding)

    # Apply zoom scaling
    clip = fitz.Rect(0, y1, page.rect.width, y2)
    pix_clipped = page.get_pixmap(matrix=mat, clip=clip, alpha=False)

    img_path = os.path.join(output_dir, f"{paper_id}_q{question_num:02d}.png")
    pix_clipped.save(img_path)
    return img_path


def parse_question_paper(qp_path, ms_path, output_dir, images_dir):
    """Parse a full question paper and extract all questions."""
    # Derive paper ID from filename
    qp_name = os.path.basename(qp_path)
    # e.g., 9708_s23_qp_31.pdf -> 2023_SJ_P31 (S=Summer/June, J=June)
    match = re.match(r'9708_([smw])(\d{2})_qp_(\d{2})\.pdf', qp_name, re.IGNORECASE)
    if not match:
        print(f"  WARNING: Cannot parse filename: {qp_name}")
        return None

    session_code = match.group(1).lower()
    year_suffix = match.group(2)
    paper_num = match.group(3)

    # Map session codes
    session_map = {'s': 'SJ', 'm': 'MJ', 'w': 'ON'}
    session = session_map.get(session_code, session_code.upper())

    # Determine full year
    year = f"20{year_suffix}"

    paper_id = f"{year}_{session}_P{paper_num}"

    print(f"  Parsing: {paper_id} ({qp_name})")

    # Parse answers
    answers = parse_mark_scheme(ms_path)
    print(f"    Found {len(answers)} answers")

    # Open QP
    doc = fitz.open(qp_path)
    total_pages = doc.page_count

    questions = []

    # Process each page
    for page_num in range(total_pages):
        page = doc[page_num]
        text = page.get_text("text")

        # Find all question numbers on this page
        # Question numbers appear at the start of lines
        q_nums = set()
        for match in re.finditer(r'(?:^|\n)\s*(\d{1,2})\s+(?=[A-Z])', text):
            num = int(match.group(1))
            if 1 <= num <= 30:
                q_nums.add(num)

        for q_num in sorted(q_nums):
            if q_num not in answers:
                continue

            # Extract full question text from the page
            full_text = extract_question_text(page, q_num)
            if not full_text:
                continue

            # Split into stem and options
            stem, options = extract_question_options(full_text)

            # Check for diagram
            has_diag = has_diagram(page, q_num)

            # Classify into chapters
            chapters = classify_question(full_text, q_num, session)

            # If question has a diagram, extract as image
            stem_image = None
            if has_diag:
                os.makedirs(images_dir, exist_ok=True)
                stem_image = extract_question_image(page, q_num, images_dir, paper_id)
                # Use relative path for web
                stem_image = os.path.relpath(stem_image, os.path.dirname(output_dir) or '.')
                stem_image = stem_image.replace('\\', '/')

            # Validate options
            if len(options) != 4:
                print(f"    WARNING: Q{q_num} has {len(options)} options, expected 4")
                # Try to fix by examining option patterns
                if len(options) < 4:
                    continue  # Skip malformed questions

            question = {
                "id": f"{paper_id}_Q{q_num:02d}",
                "paperId": paper_id,
                "questionNum": q_num,
                "chapters": chapters,
                "stemType": "image" if has_diag else "text",
                "stemText": stem if not has_diag else None,
                "stemImage": stem_image if has_diag else None,
                "options": options,
                "answer": answers[q_num]
            }

            questions.append(question)

    doc.close()
    return questions


def find_paper_pairs(directory):
    """Find QP + MS pairs in the directory."""
    files = os.listdir(directory)
    qp_files = [f for f in files if re.match(r'9708_[smw]\d{2}_qp_\d{2}\.pdf', f, re.IGNORECASE)]

    pairs = []
    for qp in sorted(qp_files):
        # Derive MS filename: 9708_s23_qp_31.pdf -> 9708_s23_ms_31.pdf
        ms = qp.replace('_qp_', '_ms_')
        ms_path = os.path.join(directory, ms)
        qp_path = os.path.join(directory, qp)
        if os.path.exists(ms_path):
            pairs.append((qp_path, ms_path))
        else:
            print(f"  WARNING: No mark scheme found for {qp}")

    return pairs


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, 'data')
    images_dir = os.path.join(base_dir, 'images')

    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(images_dir, exist_ok=True)

    pairs = find_paper_pairs(base_dir)
    print(f"Found {len(pairs)} paper pair(s)\n")

    all_questions = []
    papers_index = {}

    for qp_path, ms_path in pairs:
        questions = parse_question_paper(qp_path, ms_path, data_dir, images_dir)
        if questions:
            all_questions.extend(questions)

            # Build paper index entry
            paper_id = questions[0]['paperId']
            paper_parts = paper_id.split('_')
            papers_index[paper_id] = {
                "id": paper_id,
                "year": paper_parts[0],
                "session": paper_parts[1],
                "paper": paper_parts[2],
                "questionCount": len(questions),
                "questions": [q['id'] for q in questions]
            }

    # Write the data as a JS module (for offline loading)
    js_output_path = os.path.join(data_dir, 'questions.js')
    with open(js_output_path, 'w', encoding='utf-8') as f:
        f.write('// Auto-generated by extract_questions.py\n')
        f.write('// Cambridge A Level Economics Paper 1 MCQ Data\n')
        f.write(f'// Generated: {__import__("datetime").datetime.now().isoformat()}\n')
        f.write(f'// Total questions: {len(all_questions)}\n\n')

        f.write('const QUESTION_DATA = ')
        json.dump(all_questions, f, indent=2, ensure_ascii=False)
        f.write(';\n\n')

        f.write('const PAPER_INDEX = ')
        json.dump(papers_index, f, indent=2, ensure_ascii=False)
        f.write(';\n')

    print(f"\nDone! Extracted {len(all_questions)} questions across {len(papers_index)} papers.")
    print(f"Data written to: {js_output_path}")

    # Also write a pure JSON version
    json_output_path = os.path.join(data_dir, 'questions.json')
    with open(json_output_path, 'w', encoding='utf-8') as f:
        json.dump({
            "questions": all_questions,
            "papers": papers_index,
            "totalQuestions": len(all_questions)
        }, f, indent=2, ensure_ascii=False)

    print(f"JSON written to: {json_output_path}")


if __name__ == '__main__':
    main()
