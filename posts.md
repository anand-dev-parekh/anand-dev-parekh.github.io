---
layout: page
title: Writing
permalink: /posts/
---

{%- if site.posts.size == 0 -%}
No posts yet.
{%- else -%}
<div class="wlist">
  {%- for post in site.posts -%}
  <a class="wrow" href="{{ post.url | relative_url }}">
    <span>
      <span class="wt">{{ post.title | escape }}</span>
      {%- if site.show_excerpts and post.excerpt %}<br><span class="wd">{{ post.excerpt | strip_html | truncate: 110 }}</span>{% endif -%}
    </span>
    <span class="wm mono"><time datetime="{{ post.date | date_to_xmlschema }}">{{ post.date | date: "%b %-d, %Y" }}</time></span>
  </a>
  {%- endfor -%}
</div>
{%- endif -%}
