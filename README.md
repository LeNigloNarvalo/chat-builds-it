# dus

Zero-dependency Node.js CLI: see which entries of a directory use the most disk space.

    node bin/dus.js [dir] [-n 10] [--json] [--profondeur <N>] [--exclude <glob>]... [--tri size|name|type[:asc|:desc]] [--exclure-vide] [--min-taille <size>] [--bestiole]

`--tri` sorts by `size` (default, biggest first), `name` or `type` (directories first); add `:asc` or `:desc` to choose the direction (size defaults to desc, name/type to asc).

`--bestiole` adopts a little pet in the directory: it grows with the total size, and squeals with joy when you clean up (it remembers the last size in a `.dus-bestiole` file).

`--min-taille` hides entries smaller than a threshold (bytes, or with a `K`/`M`/`G`/`T` suffix, e.g. `10M`).

Run tests with `npm test`.

Site vitrine : ouvrir `site/index.html`.
