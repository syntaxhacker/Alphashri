import requests
from bs4 import BeautifulSoup
from rich.console import Console
from rich.tree import Tree
import argparse
import time
import bs4
console = Console()

def load_cookies():
    """
    Load cookies from the default Chrome profile using browser_cookie3.
    """
    try:
        console.print("[cyan]Attempting to load cookies from Chrome...[/cyan]")
        import browser_cookie3
        # Load cookies for the target domain
        cookies = browser_cookie3.chrome(domain_name="https://www.1tamilblasters.cool/")
        if cookies:
            console.print("[green]Cookies loaded successfully[/green]")
            return cookies
        else:
            console.print("[yellow]No cookies found for coolsite.com[/yellow]")
            return None
    except Exception as e:
        console.print(f"[red]Failed to load cookies from Chrome: {str(e)} - will proceed without authentication[/red]")
        return None

def create_session(cookies):
    """
    Create a requests.Session and set the cookies.
    """
    try:
        session = requests.Session()
        if cookies:
            for cookie in cookies:
                session.cookies.set(
                    name=cookie.name,
                    value=cookie.value,
                    domain=cookie.domain,
                    path=cookie.path,
                    secure=cookie.secure,
                    expires=cookie.expires
                )
                console.print(f"[green]Set cookie: {cookie.name} for domain {cookie.domain}[/green]")
            console.print("[green]Cookies set in session[/green]")
        else:
            console.print("[yellow]Warning: Creating session without cookies[/yellow]")
        return session
    except Exception as e:
        console.print(f"[red]Error creating session: {str(e)}[/red]")
        return requests.Session()

def log_element(element, tree, depth=0):
    """
    Recursively traverse the DOM tree and log each element with its hierarchy.
    """
    indent = "  " * depth
    tag = element.name
    attrs = " ".join([f'{key}="{value}"' for key, value in element.attrs.items()])
    if attrs:
        tag_with_attrs = f"{tag} {attrs}"
    else:
        tag_with_attrs = tag
    tree.add(f"{indent}{tag_with_attrs}")
    for child in element.children:
        if isinstance(child, BeautifulSoup):
            continue
        if isinstance(child, str):
            if child.strip():
                tree.add(f"{indent}  {child.strip()}")
        elif isinstance(child, bs4.element.Tag):
            log_element(child, tree, depth + 1)

def scrape_coolsite(session):
    """Scrape coolsite.com and filter for Telugu content with consolidated movie listings."""
    base_url = "https://www.1tamilblasters.cool/index.php?/forums/forum/78-telugu-new-movies-hdrips-bdrips-dvdrips-hdtv/"
    console.print("[cyan]Starting scraping process for Telugu movies...[/cyan]")
    console.print(f"[cyan]Attempting to connect to {base_url}[/cyan]")

    time.sleep(2)

    try:
        response = session.get(base_url, timeout=15)
        if response.status_code != 200:
            console.print(f"[red]Failed to load page. Status code: {response.status_code}[/red]")
            return
    except requests.exceptions.RequestException as e:
        console.print(f"[red]Request failed: {str(e)}[/red]")
        return

    console.print("[cyan]Page loaded successfully[/cyan]")
    soup = BeautifulSoup(response.text, 'html.parser')
    
    # Find all movie entries
    movie_entries = soup.find_all('li', class_='ipsDataItem')
    movies_data = {}

    for entry in movie_entries:
        try:
            title_element = entry.find('span', class_='ipsType_break')
            if not title_element:
                continue

            title_text = title_element.get_text(strip=True)
            
            # Extract base movie name and year
            import re
            base_match = re.match(r'^([^(\[]+?)(?:\s*\((\d{4})\))?', title_text)
            if base_match:
                base_title = base_match.group(1).strip()
                year = base_match.group(2) if base_match.group(2) else 'Unknown Year'
            else:
                continue

            # Extract quality, format and size information
            quality_info = re.findall(r'\[(.*?)\]', title_text)
            
            # Parse quality details
            quality_details = []
            size = 'Unknown Size'
            for info in quality_info:
                # Extract resolution
                if any(res in info for res in ['4K', '2160p', '1080p', '720p', 'HDRip', 'BDRip', 'DVDRip', 'HDTV']):
                    quality_details.append(info)
                # Extract size if present
                size_match = re.search(r'\d+(?:\.\d+)?(?:GB|MB)', info)
                if size_match:
                    size = size_match.group(0)
            
            quality_str = ' | '.join(quality_details) if quality_details else 'Unknown Quality'

            version_info = {
                'full_title': title_text,
                'quality': quality_str,
                'size': size,
                'post_date': entry.find('time')['datetime'] if entry.find('time') else 'Unknown',
                'views': entry.find('span', class_='ipsDataItem_stats_number').get_text(strip=True) if entry.find('span', class_='ipsDataItem_stats_number') else '0',
                'poster': entry.find('a', class_='ipsType_break').find('span', style=True).get_text(strip=True) if entry.find('a', class_='ipsType_break') else 'Unknown'
            }

            # Group versions under the base movie title
            if base_title not in movies_data:
                movies_data[base_title] = {
                    'versions': [],
                    'latest_date': version_info['post_date'],
                    'total_views': 0
                }
            
            movies_data[base_title]['versions'].append(version_info)
            movies_data[base_title]['total_views'] += int(version_info['views'])
            
        except Exception as e:
            console.print(f"[red]Error processing entry: {str(e)}[/red]")
            continue

    # Display the consolidated information
    for movie_title, movie_info in sorted(movies_data.items(), key=lambda x: x[1]['latest_date'], reverse=True):
        console.print(f"\n[green]Movie: {movie_title}[/green]")
        console.print(f"[white]Total Views:[/white] {movie_info['total_views']}")
        console.print(f"[white]Latest Post:[/white] {movie_info['latest_date']}")
        console.print("[white]Available Versions:[/white]")
        
        # Sort versions by quality (assuming higher quality files are larger)
        for version in sorted(movie_info['versions'], key=lambda x: x['quality'], reverse=True):
            console.print(f"  • {version['quality']} | {version['size']}")
            console.print(f"    Posted: {version['post_date']} by {version['poster']}")

    return movies_data
    console.print("[cyan]Parsing DOM structure...[/cyan]")

    # Initialize a Rich Tree for hierarchical logging
    dom_tree = Tree("DOM Structure:")

    # Start logging from the root element
    log_element(soup, dom_tree)

    # Print the DOM tree
    console.print(dom_tree)

    # Optionally, you can also extract the unique elements
    unique_elements = set(tag.name for tag in soup.find_all())
    console.print("[cyan]Unique elements in the DOM:[/cyan]")
    for element in unique_elements:
        console.print(f"- {element}")

def display_results(torrents):
    """
    Display the scraped torrents in a rich table.
    """
    if not torrents:
        console.print("[yellow]No torrents found.[/yellow]")
        return

    table = Table(title="TorrentGalaxy Torrents", show_header=True, header_style="bold cyan", border_style="blue")
    table.add_column("Name", justify="left")
    table.add_column("Size", justify="right")
    table.add_column("Seeds", justify="right")
    table.add_column("Leeches", justify="right")
    table.add_column("Uploaded By", justify="left")
    table.add_column("Link", justify="left")

    for torrent in torrents:
        table.add_row(
            torrent["Name"],
            torrent["Size"],
            torrent["Seeds"],
            torrent["Leeches"],
            torrent["Uploaded By"],
            torrent["Link"]
        )

    console.print(table)

def export_to_csv(torrents, filename):
    """
    Export the scraped torrents to a CSV file.
    """
    if not torrents:
        console.print("[yellow]No torrents to export.[/yellow]")
        return

    keys = torrents[0].keys()
    with open(filename, 'w', newline='', encoding='utf-8') as output_file:
        dict_writer = csv.DictWriter(output_file, fieldnames=keys)
        dict_writer.writeheader()
        dict_writer.writerows(torrents)
    console.print(f"[green]Torrents exported to {filename}[/green]")

def parse_args():
    parser = argparse.ArgumentParser(description='Coolsite.com Scraper with Requests')
    parser.add_argument('--pages', type=int, default=1, help='Number of pages to scrape')
    parser.add_argument('--export', type=str, default='torrents.csv', help='Filename to export torrents to')
    return parser.parse_args()

def main():
    console.print("[cyan]Starting Coolsite.com Scraper...[/cyan]")
    args = parse_args()
    console.print(f"[cyan]Arguments parsed: pages={args.pages}, export={args.export}[/cyan]")

    # Load cookies
    console.print("[cyan]Step 1: Loading cookies...[/cyan]")
    cookies = load_cookies()
    # Modified to continue even without cookies
    console.print("[cyan]Step 2: Creating session...[/cyan]")
    session = create_session(cookies)

    # Scrape torrents
    console.print("[cyan]Step 3: Starting scraping process...[/cyan]")
    scrape_coolsite(session)

    # Since the original script was for scraping torrents, and the new site may not have torrents,
    # you might want to adjust the scraping logic accordingly.
    # For demonstration, we'll assume the site has a similar torrent listing structure.
    # Otherwise, you can remove or modify the following part.

    # Example: If the site has a torrent listing, you might want to scrape it
    # torrents = scrape_coolsite(session, max_pages=args.pages)
    # display_results(torrents)
    # export_to_csv(torrents, args.export)

    console.print("[green]Script execution completed[/green]")

if __name__ == "__main__":
    main()