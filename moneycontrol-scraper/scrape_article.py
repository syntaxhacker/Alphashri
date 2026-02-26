#!/usr/bin/env python3
"""Scrape a specific article from moneycontrol.com and extract full text content"""

from scrapling.fetchers import Fetcher

# URL of the article to scrape
url = 'https://www.moneycontrol.com/news/india/mumbai-bmc-tables-highest-ever-budget-of-rs-80-952-crore-for-fy27-focuses-on-infra-education-13843286.html'

print(f"Fetching article: {url}\n")
print("=" * 80)

page = Fetcher.get(url, impersonate='chrome')

# Get article title
title = page.css('h1::text').get()
print(f"TITLE: {title}")
print("=" * 80)

# Get article meta info
author = page.css('.article_author, .author_name, .byline::text').get()
date = page.css('.article_date, .publish_date, .date::text').get()

if author:
    print(f"Author: {author.strip()}")
if date:
    print(f"Date: {date.strip()}")
print()

# Get full article content
print("=" * 80)
print("FULL ARTICLE CONTENT")
print("=" * 80)
print()

# Try different selectors for article content
content_selectors = [
    '.article_content',
    '.article-body',
    '.content',
    'article',
    '.story-content',
    '.post-content',
    '.entry-content',
]

article_text = None
for selector in content_selectors:
    content = page.css(selector)
    if content:
        # Get all paragraphs
        paragraphs = content[0].css('p::text').getall()
        if paragraphs:
            article_text = '\n\n'.join(p.strip() for p in paragraphs if p.strip())
            break

# If no content found with selectors, try getting all paragraphs from the page
if not article_text:
    # Get all paragraphs, filter out navigation/ads
    all_paragraphs = page.css('p::text').getall()
    # Filter paragraphs that are likely article content (more than 50 chars)
    article_paragraphs = [p.strip() for p in all_paragraphs if len(p.strip()) > 50]

    if article_paragraphs:
        article_text = '\n\n'.join(article_paragraphs)

if article_text:
    print(article_text)
else:
    # Last resort: get all text from body
    print("Extracting all text content...\n")
    all_text = page.css('body ::text').getall()
    # Join and clean
    full_text = ' '.join(text.strip() for text in all_text if text.strip())
    # Print in chunks
    print(full_text[:5000])  # First 5000 chars

print()
print("=" * 80)
print("END OF ARTICLE")
print("=" * 80)
