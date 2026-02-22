import feedparser

feeds = [
    {
        'name': 'TLDR AI (New)',
        'url': 'https://bullrich.dev/tldr-rss/ai.rss',
        'priority': 'P0 - 최우선순위'
    },
    {
        'name': 'TLDR Tech (All)',
        'url': 'https://bullrich.dev/tldr-rss/feed.rss',
        'priority': 'P0 - 추가'
    }
]

for feed_info in feeds:
    print(f"\n{'='*80}")
    print(f"Testing: {feed_info['name']}")
    print(f"Priority: {feed_info['priority']}")
    print(f"URL: {feed_info['url']}")
    print('='*80)
    
    feed = feedparser.parse(
        feed_info['url'],
        agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    )
    
    if feed.bozo:
        print(f"❌ Error: {feed.bozo_exception}")
    else:
        print(f"✅ Status: OK")
        print(f"   Items: {len(feed.entries)}")
        
        if len(feed.entries) > 0:
            print(f"\n   Latest 3 items:")
            for i, entry in enumerate(feed.entries[:3]):
                print(f"   {i+1}. {entry.get('title', 'N/A')[:70]}")
                print(f"      Link: {entry.get('link', 'N/A')}")
                print(f"      Published: {entry.get('published', entry.get('updated', 'N/A'))}")
                print()

print("\n" + "="*80)
print("✅ 두 피드 모두 정상 작동하면 rss.json에 반영하겠습니다.")
print("="*80)
