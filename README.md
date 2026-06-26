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

# Usage
To use this userscript yourself today install [Violentmonkey](https://violentmonkey.github.io/get-it/).
To add a script, open the extention and click on the `+` button to add a new script.
Paste the contents of user.js in there and save.
Visit old.reddit.com/r/popular (or any page of your choice) 
Note: after saving the script you will need to reload the page.
