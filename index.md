---
layout: default
title: Posts
---

{% for post in site.posts %}
- [{{ post.title }}]({{ post.url }}) <span class="meta">({{ post.date | date: "%Y-%m-%d" }})</span>
{% endfor %}
