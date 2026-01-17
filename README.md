# Minimal GitHub Pages Blog (Jekyll + Minima)

This repo is ready to push to GitHub and deploy with **GitHub Pages**.

## 1) Quick start

1. Create a new GitHub repo.
   - **User site** (recommended): `YOURUSERNAME.github.io`
   - **Project site**: any repo name (e.g., `my-blog`)

2. Upload/push these files to the repo.

3. In GitHub:
   - Go to **Settings → Pages**
   - Under **Build and deployment** set:
     - **Source**: `Deploy from a branch`
     - **Branch**: `main` (or `master`) and folder `/ (root)`

4. Your site will appear at:
   - User site: `https://YOURUSERNAME.github.io/`
   - Project site: `https://YOURUSERNAME.github.io/REPO_NAME/`

## 2) The only required edits

Open `_config.yml` and change:

- `title:`
- `description:`
- **If using a project site** (repo name not `YOURUSERNAME.github.io`):
  - set `baseurl: "/REPO_NAME"`

That’s it.

## 3) Add a new post

Create a new Markdown file in `_posts/` named like:

`YYYY-MM-DD-my-post-title.md`

Example front matter:

```md
---
layout: post
title: "My Post Title"
date: 2026-01-17
---

Write here.
```

## 4) LaTeX / Math

This template includes **MathJax**.

Use inline math:

`$E = mc^2$`

And display math:

```tex
$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
```

If you don’t want MathJax, set `mathjax: false` in `_config.yml`.

## 5) Change the color scheme

Edit `assets/css/style.scss`.

- Change `--bg`, `--text`, `--muted`, `--link`
- For dark mode, set a dark `--bg` and light `--text`.

## 6) What’s in here

- `index.md` — tiny landing page
- `posts.md` — list of posts (clickable)
- `about.md` — about page
- `_posts/` — your blog posts
- `_includes/head.html` — adds MathJax (optional)
- `assets/css/style.scss` — minimal color + typography overrides
