---
layout: default
title: Posts
permalink: /posts/
---

{% for post in site.posts %}
- [{{ post.title }}]({{ post.url }}) <span class="meta">({{ post.date | date: "%Y-%m-%d" }})</span>
{% endfor %}
