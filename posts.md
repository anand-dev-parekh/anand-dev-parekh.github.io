---
layout: page
title: Posts
permalink: /posts/
---

{%- if site.posts.size == 0 -%}
No posts yet.
{%- else -%}
<ul class="post-list">
  {%- for post in site.posts -%}
    <li>
      <h3 style="margin: 0;">
        <a class="post-link" href="{{ post.url | relative_url }}">{{ post.title | escape }}</a>
      </h3>
      {%- if site.show_excerpts -%}
        <p style="margin: 0.25rem 0 1rem 0;">{{ post.excerpt }}</p>
      {%- endif -%}
    </li>
  {%- endfor -%}
</ul>
{%- endif -%}
