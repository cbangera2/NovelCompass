import re
from urllib.parse import urljoin, urlsplit
from typing import Dict, Any, List
from bs4 import BeautifulSoup
from bs4.element import Tag

def parse_series_page(html_content: str, url: str = "") -> Dict[str, Any]:
    soup = BeautifulSoup(html_content, 'html.parser')

    canonical = soup.find('link', rel='canonical')
    canonical_url = canonical.get('href', '') if canonical else url
    slug_match = re.search(r'/series/([^/]+)/?', canonical_url or '')
    slug = slug_match.group(1) if slug_match else None

    # 1. Novel ID
    novel_id = None
    pid_input = soup.find('input', id='mypostid')
    if pid_input and pid_input.get('value', '').isdigit():
        novel_id = int(pid_input['value'])
    else:
        pid_match = re.search(r'\bpid=(\d+)', html_content)
        if pid_match:
            novel_id = int(pid_match.group(1))

    # 2. Title
    title_elem = soup.find('div', class_='seriestitlenu')
    if not title_elem:
        title_elem = soup.find('meta', property='og:title')
        title = title_elem.get('content', '').strip() if title_elem else ""
    else:
        title = title_elem.text.strip()

    # 3. Synopsis
    syn_elem = soup.find('div', id='editdescription')
    synopsis = syn_elem.text.strip() if syn_elem else ""

    # 4. Cover URL
    cover_elem = soup.find('div', class_='serieseditimg')
    cover_url = cover_elem.find('img')['src'] if cover_elem and cover_elem.find('img') else ""

    # 5. Rating & Rating Votes
    rating_val = 0.0
    rating_votes = 0
    rating_meta = soup.find('meta', property='ratingValue')
    if rating_meta:
        try:
            rating_val = float(rating_meta['content'])
        except ValueError:
            pass
    votes_meta = soup.find('meta', property='ratingCount')
    if votes_meta:
        try:
            rating_votes = int(votes_meta['content'])
        except ValueError:
            pass

    if rating_votes == 0:
        uvotes = soup.find('span', class_='uvotes')
        if uvotes:
            m = re.search(r'\(([\d.]+)\s*/\s*5\.0,\s*(\d+)\s*votes\)', uvotes.text)
            if m:
                rating_val = float(m.group(1))
                rating_votes = int(m.group(2))

    # 5.1 Star Rating Breakdown (5, 4, 3, 2, 1)
    rating_votes_5 = 0
    rating_votes_4 = 0
    rating_votes_3 = 0
    rating_votes_2 = 0
    rating_votes_1 = 0
    rates_table = soup.find('table', id='myrates')
    if rates_table:
        for tr in rates_table.find_all('tr'):
            tds = tr.find_all('td')
            if len(tds) >= 2:
                star_text = tds[0].text.strip()
                vspan = tds[1].find('span', class_='votetext')
                vtext = vspan.text.strip() if vspan else tds[1].text.strip()
                vm = re.search(r'\((\d+)\s*votes?\)', vtext, re.I)
                if star_text.isdigit() and vm:
                    s_num = int(star_text)
                    v_cnt = int(vm.group(1))
                    if s_num == 5:
                        rating_votes_5 = v_cnt
                    elif s_num == 4:
                        rating_votes_4 = v_cnt
                    elif s_num == 3:
                        rating_votes_3 = v_cnt
                    elif s_num == 2:
                        rating_votes_2 = v_cnt
                    elif s_num == 1:
                        rating_votes_1 = v_cnt

    # 6. Reading List Count
    reading_list_count = 0
    rlist_elem = soup.find('b', class_='rlist')
    if rlist_elem:
        try:
            reading_list_count = int(rlist_elem.text.replace(',', '').strip())
        except ValueError:
            pass

    # 7. Author, Language, Year, Translation Status
    author_div = soup.find("div", id="showauthors")
    authors = (
        [a.get_text(" ", strip=True) for a in author_div.find_all("a")]
        if author_div
        else []
    )
    if not authors:
        auth_elem = soup.find('a', id='authtag')
        authors = [auth_elem.text.strip()] if auth_elem else []
    author = ", ".join(dict.fromkeys(authors))

    language = ""
    lang_div = soup.find('div', id='showlang')
    if lang_div and lang_div.find('a'):
        language = lang_div.find('a').text.strip()

    year = None
    year_div = soup.find('div', id='edityear')
    if year_div:
        m = re.search(r'\b(19\d\d|20\d\d)\b', year_div.text)
        if m:
            year = int(m.group(1))

    status_trans = ""
    trans_div = soup.find('div', id='showtranslated')
    if trans_div:
        status_trans = trans_div.text.strip()

    # 8. Genres & Tags
    genres = []
    genre_div = soup.find('div', id='seriesgenre')
    if genre_div:
        genres = [a.text.strip() for a in genre_div.find_all('a') if a.text.strip()]

    tags = []
    tag_div = soup.find('div', id='showtags')
    if tag_div:
        tags = [a.text.strip() for a in tag_div.find_all('a') if a.text.strip()]

    # 9. Related Series & Direct Recommendations
    related_series = []
    rel_div = soup.find('div', id='editrelated')
    rel_links = rel_div.find_all("a") if rel_div else _section_links(
        soup, r"^\s*Related Series\s*"
    )
    for link in rel_links:
            href = link.get('href', '')
            m = re.search(r'/series/([^/]+)', href)
            if m:
                related_series.append({
                    'id': _series_id_from_link(link),
                    'slug': m.group(1),
                    'title': link.text.strip(),
                    'url': href
                })

    direct_recs = []
    rec_div = soup.find('div', id='editrecommend') or soup.find('div', class_='recom_box')
    rec_links = rec_div.find_all("a") if rec_div else _section_links(
        soup, r"^\s*Recommendations\s*"
    )
    for link in rec_links:
            href = link.get('href', '')
            m = re.search(r'/series/([^/]+)', href)
            if m:
                votes_match = re.search(r"Recommended by\s+(\d+)", link.get("title", ""), re.I)
                direct_recs.append({
                    'id': _series_id_from_link(link),
                    'slug': m.group(1),
                    'title': link.text.strip(),
                    'url': href,
                    'votes': int(votes_match.group(1)) if votes_match else 1,
                })

    associated_div = soup.find("div", id="editassociated")
    associated_names = (
        list(associated_div.stripped_strings) if associated_div else []
    )
    rec_list_ids = []
    for link in soup.select('ol.ulc_sp a[href*="/viewlist/"]'):
        match = re.search(r"/viewlist/(\d+)", link.get("href", ""))
        if match:
            rec_list_ids.append(int(match.group(1)))

    return {
        'id': novel_id,
        'slug': slug,
        'title': title,
        'cover_url': cover_url,
        'synopsis': synopsis,
        'rating': rating_val,
        'rating_votes': rating_votes,
        'rating_votes_5': rating_votes_5,
        'rating_votes_4': rating_votes_4,
        'rating_votes_3': rating_votes_3,
        'rating_votes_2': rating_votes_2,
        'rating_votes_1': rating_votes_1,
        'reading_list_count': reading_list_count,
        'author': author,
        'associated_names': associated_names,
        'language': language,
        'year': year,
        'status_trans': status_trans,
        'genres': genres,
        'tags': tags,
        'related_series': related_series,
        'direct_recs': direct_recs,
        'recommendation_list_ids': list(dict.fromkeys(rec_list_ids)),
    }


def _series_id_from_link(link) -> int | None:
    for value in (link.get("id", ""), " ".join(link.get("class", []))):
        match = re.search(r"(?:sid|ser|series)?[_-]?(\d+)", value, re.I)
        if match:
            return int(match.group(1))
    return None


def _section_links(soup: BeautifulSoup, heading_pattern: str):
    heading = soup.find(
        ["h4", "h5"], string=re.compile(heading_pattern, re.I)
    )
    if heading is None:
        # Headings often contain edit controls, so match their full text.
        heading = next(
            (
                candidate
                for candidate in soup.find_all(["h4", "h5"])
                if re.search(
                    heading_pattern,
                    candidate.get_text(" ", strip=True),
                    re.I,
                )
            ),
            None,
        )
    if heading is None:
        return []
    links = []
    for sibling in heading.next_siblings:
        if isinstance(sibling, Tag) and sibling.name in {"h4", "h5"}:
            break
        if not isinstance(sibling, Tag):
            continue
        if sibling.name == "a":
            links.append(sibling)
        links.extend(sibling.find_all("a"))
    return links


def parse_discovery_page(html_content: str, url: str) -> Dict[str, Any]:
    """Extract canonical series links and pagination without page-specific coupling."""
    soup = BeautifulSoup(html_content, "html.parser")
    series = {}
    for link in soup.select('a[href*="/series/"]'):
        absolute = urljoin(url, link.get("href", ""))
        parts = urlsplit(absolute)
        match = re.search(r"/series/([^/]+)/?", parts.path)
        if not match:
            continue
        slug = match.group(1).lower()
        series[slug] = {
            "slug": slug,
            "title": link.get_text(" ", strip=True),
            "url": f"https://www.novelupdates.com/series/{slug}/",
            "id": _series_id_from_link(link),
        }

    pages = {1}
    for link in soup.select("a[href]"):
        absolute = urljoin(url, link.get("href", ""))
        if urlsplit(absolute).path != urlsplit(url).path:
            continue
        match = re.search(r"(?:[?&](?:pg|page)=|/page/)(\d+)", absolute)
        if match:
            pages.add(int(match.group(1)))
    return {"series": list(series.values()), "max_page": max(pages)}

def parse_viewlist_page(html_content: str, list_id: int = None) -> Dict[str, Any]:
    soup = BeautifulSoup(html_content, 'html.parser')

    # Title
    title_elem = soup.find('div', class_='uclp_title') or soup.find('h3', class_='mypage') or soup.find('h1')
    title = title_elem.text.strip() if title_elem else ""

    # Description
    desc_elem = soup.find('div', class_='uclp_desc') or soup.find('div', class_='lid_desc')
    description = desc_elem.text.strip() if desc_elem else ""

    # Curator
    curator = ""
    curator_elem = soup.find('div', class_='uclp_name author') or soup.find('a', href=re.compile(r'/user/'))
    if curator_elem:
        curator = curator_elem.text.strip()

    # Followers
    followers = 0
    fol_elem = soup.find('span', id='flw_cnt') or soup.find('span', class_='lid_followers')
    if fol_elem:
        m = re.search(r'(\d+)', fol_elem.text)
        if m:
            followers = int(m.group(1))

    # Items
    items = []
    boxes = soup.find_all('div', class_=re.compile(r'search_main_box_nu'))
    for pos, box in enumerate(boxes, 1):
        title_div = box.find('div', class_='search_title')
        if not title_div or not title_div.find('a'):
            continue
        link = title_div.find('a')
        item_title = link.text.strip()
        slug_match = re.search(r'/series/([^/]+)', link['href'])
        slug = slug_match.group(1) if slug_match else ""

        # Novel ID from class name search_main_box_nu <sid>
        nid = None
        for cls in box.get('class', []):
            if cls.isdigit():
                nid = int(cls)
                break

        # Comment
        comment = ""
        if nid:
            comment_div = box.find('div', class_=re.compile(f'edit_content_{nid}'))
            if comment_div:
                comment = comment_div.text.strip()

        tier = ""
        if comment:
            tier_match = re.search(r'\b(S-tier|A-tier|B-tier|C-tier|S|A\+|A|B)\b', comment, re.IGNORECASE)
            if tier_match:
                tier = tier_match.group(1).upper()

        items.append({
            'position': pos,
            'novel_id': nid,
            'slug': slug,
            'title': item_title,
            'tier': tier,
            'comment': comment
        })

    return {
        'id': list_id,
        'title': title,
        'description': description,
        'curator': curator,
        'followers': followers,
        'items': items
    }
