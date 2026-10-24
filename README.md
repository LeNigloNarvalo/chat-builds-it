# dus

Zero-dependency Node.js CLI: see which entries of a directory use the most disk space.

    node bin/dus.js [dir] [-n 10] [--json] [--profondeur <N>] [--exclude <glob>]... [--tri size|name|type[:asc|:desc]] [--exclure-vide]

`--tri` sorts by `size` (default, biggest first), `name` or `type` (directories first); add `:asc` or `:desc` to choose the direction (size defaults to desc, name/type to asc).

Run tests with `npm test`.

Site vitrine : ouvrir `site/index.html`.
