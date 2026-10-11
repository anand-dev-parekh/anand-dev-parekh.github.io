# Org logos

Drop a file here and the matching row on the home page picks it up — the
`_includes/org-logo.html` include checks whether the file exists in the built
site and falls back to the monogram if not. Nothing else to edit unless you
want a different filename than the one already named in the YAML.

Currently referenced by `_data/experience.yml` and `_data/education.yml`:

| file                | org                                   |
|---------------------|---------------------------------------|
| `mastercard.svg`    | Mastercard                            |
| `bascom-hunter.svg` | Bascom Hunter                         |
| `washu.svg`         | Washington University in St. Louis (also MVRL) |
| `7d-imaging.svg`    | 7D Imaging                            |

Notes:

- SVG is preferred; PNG works, just change the extension in the YAML.
- There's no chip behind the logo any more, so the file has to be clean:
  transparent background and a viewBox cropped tight to the mark. Traced or
  exported logos often have a full-canvas white rectangle as the first path,
  and that shows up as a white box. The logo is fit inside 32×26px and centred
  on the title line.
- The page is dark. A logo drawn in dark ink will disappear. Set
  `plate: "light"` on that entry to put a small light backing behind it.
- These are other people's trademarks. Using them to describe where you worked
  is normal, but keep them unmodified and don't restyle them into something the
  org didn't publish.
