---
layout: page
title: Follow by RSS
permalink: /rss/
---

{%- assign feed = "/feed.xml" | absolute_url -%}

RSS lets you follow this site without checking back. Add it to a feed reader
and new posts show up there automatically, alongside everything else you
follow. No account, no email, no algorithm.

### How to subscribe

1. Open a feed reader, for example [NetNewsWire](https://netnewswire.com/)
   (free, Mac and iPhone), [Feedly](https://feedly.com/) or
   [Inoreader](https://www.inoreader.com/) (web and phone).
2. Add this address:

<pre><code>{{ feed }}</code></pre>

Most readers also accept just `{{ site.url | remove: "https://" }}` and find
the feed themselves.

### Recent posts

{% if site.posts.size == 0 -%}
No posts yet.
{%- else -%}
<div class="wlist">
  {%- for post in site.posts limit: 5 -%}
  <a class="wrow" href="{{ post.url | relative_url }}">
    <span class="wt">{{ post.title | escape }}</span>
    <span class="wm mono"><time datetime="{{ post.date | date_to_xmlschema }}">{{ post.date | date: "%b %-d, %Y" }}</time></span>
  </a>
  {%- endfor -%}
</div>
{%- endif %}
