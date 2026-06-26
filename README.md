# "Enhanced" viewing experience for old.reddit.com

Contents of old.reddit.com/* displayed in a grid with infinite scroll. (Much like the search page for tiktok or instagram, but with hopefully better content)

# General knobs
- cardSize
- gap
- maxWidth
- cardClick ('content' vs 'comments')
- showTitleOnHover
- hideTextPosts (set true for a pure media grid)
- blurNSFW
- openInNewTab

# Prefetching knobs
- infiniteScroll: master on/off (set false to go back to the manual "next" footer).
- prefetchPages: how many pages to keep buffered ahead (default 2; bump to 3–4 for heavier look-ahead).
- prefetchImages: warm images for buffered pages too.
- triggerMargin: how early (px from bottom) loading kicks in.
