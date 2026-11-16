---
name: stark-office
runtimes:
  - claude
  - codex
description: >-
  Use when a task reads, writes or edits an .xlsx, .xlsm, .docx, .pptx or
  .pdf file, as input or output. Use instead of openpyxl, python-docx,
  python-pptx or pypdf, and in place of the built-in xlsx, docx, pptx and pdf
  skills.
argument-hint: "[xlsx | docx | pptx | pdf]"
---

## Help

If `$ARGUMENTS` contains a standalone `--help`, `-h`, or `help`,
follow [standard help](../../standards/help.md), then stop.

## Arguments

- `xlsx`, `docx`, `pptx` or `pdf`: the format. With none, use the format of
  the file that the task names.

# stark-office

plume is the fleet's toolkit for Office and PDF files. Each format has its
own command-line tool. Use these tools for each read, write and edit of such
a file.

## The rule

Do not write Python, or any other script, that reads or writes an Office or
PDF file: no openpyxl, python-docx, python-pptx or pypdf, and no one-time
converter. Filter the JSON that plume prints with `jq`, never with Python.
When a plume tool cannot do a step, file a ticket on plume with
`/stark-ticket` (`$stark-ticket` on Codex), and say so in your report. Do not
work around the gap.

Your own file-read tool can show the pages of a PDF, such as a scanned PDF
that has no text. It runs no script, so use it when it does the step.

## The tools

| Tool | Files |
|---|---|
| `plume` | Lists the tools, and runs one: `plume xlsx <args>` runs `plume-xlsx <args>`. |
| `plume-xlsx` | Excel: `.xlsx`, `.xlsm` |
| `plume-docx` | Word: `.docx` |
| `plume-pptx` | PowerPoint: `.pptx` |
| `plume-pdf` | PDF |
| `plume-font` | Web fonts: WOFF and WOFF2 to TTF or OTF |

- Each tool writes data on stdout and diagnostics on stderr. Exit 0 is ok,
  1 is a runtime error, and 2 is a usage error. A checker (`check`, `a11y`)
  also exits 1 on a fail: read its output to know which.
- For Word, PowerPoint, PDF and fonts, run `<tool> --help`, then
  `<tool> <command> --help`. Use the command forms that they print. Do not
  guess a command or a flag.
- When `plume` is not on the `PATH`, install it:
  `brew install 21StarkCom/tap/plume`. The formula is for macOS on Apple
  silicon only.

## Excel

The recipes below cover most tasks. `plume-xlsx --help` lists the other
commands: `inspect`, `eval`, `recalc`, `a11y` and `schema`.

### Read

```
plume-xlsx read --cells <file.xlsx>
```

- It prints one JSON line for each cell with a value, a formula or a note:
  `sheet`, `ref`, `kind`, `value`, and `formula`, `shared`, `fill`,
  `comment`, `merge` and `list` when the cell has them. A blank cell gets no
  line.
- A cell with `shared` holds a formula too: the formula of the master cell
  that `shared` names.
- `--sheet <name or 1-based index>` reads one sheet.
- `plume-xlsx inspect <file.xlsx>` gives a summary of the sheets.
- `plume-xlsx read <file.xlsx>` prints the full Document, which is long. Use
  it, through `jq`, to see what `--cells` does not show:
  - The `style` of one cell:
    `plume-xlsx read <file.xlsx> | jq '.sheets[] | select(.name == "<sheet>") | .rows[].cells[]? | select(.ref == "C16") | .style'`
  - The data validations of one sheet, which give the allowed values of a
    blank cell:
    `plume-xlsx read <file.xlsx> | jq '.sheets[] | select(.name == "<sheet>") | .dataValidations'`

### Edit an existing file

1. Write the edits to a JSON file with your file tool. Do not pass them
   through `echo`: zsh's `echo` turns `\n` into a line break, and `set`
   refuses the JSON.

   ```json
   [
     {
       "sheet": 2,
       "ref": "C16",
       "value": "Yes",
       "style": {
         "fill": {"type": "solid", "color": "#FFF2CC"},
         "alignment": {"wrapText": true}
       },
       "comment": {"author": "plume", "text": "Source: policy\nLine two", "width": 300, "height": 160}
     }
   ]
   ```

   - `sheet` is a name or a 1-based index. Each item has `sheet`, `ref`, and
     one or more of `value`, `style` and `comment`.
   - `value: null` removes the value. A new value replaces a formula.
   - `comment` is a note. `\n` in its `text` starts a new line. `width` and
     `height` are the box size in points.
2. Write the result to a new path, so that you can prove the edit. Keep the
   extension of the input: an `.xlsm` stays `.xlsm`.

   ```
   plume-xlsx set <in.xlsx> <edits.json> -o <out.xlsx>
   ```

3. After the proof below, copy the result to the path that the task names.

- `set` keeps each part of the workbook that the edits do not touch. Use it
  for each edit of an existing file. Use `build` only for a new file.
- `plume-xlsx set --help` lists the edits that it refuses. `plume-xlsx schema`
  gives each style field, in its `CellStyle` shape.
- A value edit does not compute the formulas: each formula cell keeps its old
  cached `value` until Excel opens the file. To get a new result, run
  `plume-xlsx eval <file.xlsx> <Sheet!A1>`. Do not run `recalc` on a file that
  `set` wrote: `recalc` writes the workbook again, and can lose the parts that
  `set` kept.

### Prove an edit

1. List the changed cells:

   ```
   plume-xlsx diff <before.xlsx> <after.xlsx>
   ```

   Make sure that it lists only the cells that you meant to change. `diff`
   does not compare styles, so it does not list an edit of a style alone. To
   prove a style, read the cell's `style` with the `jq` filter of
   [Read](#read).
2. Check the cells against their data validation:

   ```
   plume-xlsx check <after.xlsx>
   ```

   - Exit 0 means that no checked cell breaks its rule. `check` skips the
     cells that the `skipped` count gives, and it does not see a rule in
     `extLst`: Excel often puts a list from another sheet there. Do not
     report those cells as valid.
   - Exit 1 means a broken cell, or a file that `check` cannot read. The last
     line on stderr says which. On a broken cell, run `check` on the before
     file too. A broken cell that the before file has is not yours: name it
     in your report.

### Make a new file

- From CSV or TSV: `plume-xlsx csv <in.csv> -o <out.xlsx>`.
  `plume-xlsx csv --help` lists the delimiter and header flags.
- From a JSON Document: `plume-xlsx build <doc.json> -o <out.xlsx>`.
  `plume-xlsx schema` prints the shape of the Document, and
  `plume-xlsx read <file.xlsx>` prints a Document to copy from.
