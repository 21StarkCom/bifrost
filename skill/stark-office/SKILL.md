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
converter. When a plume tool cannot do a step, file a ticket on plume with
`/stark-ticket` (`$stark-ticket` on Codex), and say so in your report. Do not
work around the gap.

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
  1 is a runtime error, and 2 is a usage error.
- For Word, PowerPoint, PDF and fonts, run `<tool> --help`, then
  `<tool> <command> --help`. Use the command forms that they print. Do not
  guess a command or a flag.
- When `plume` is not on the `PATH`, install it:
  `brew install 21StarkCom/tap/plume`.

## Excel

The recipes below cover most tasks. `plume-xlsx --help` lists the other
commands: `inspect`, `eval`, `recalc`, `a11y` and `schema`.

### Read

```
plume-xlsx read --cells <file.xlsx>
```

- It prints one JSON line for each cell with a value, a formula or a note:
  `sheet`, `ref`, `kind`, `value`, and `formula`, `fill`, `comment`, `merge`
  and `list` when the cell has them. A blank cell gets no line.
- `--sheet <name or 1-based index>` reads one sheet.
- `plume-xlsx inspect <file.xlsx>` gives a summary of the sheets.

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
2. Write the result to a new path, so that you can prove the edit:

   ```
   plume-xlsx set <in.xlsx> <edits.json> -o <out.xlsx>
   ```

- `set` keeps each part of the workbook that the edits do not touch. Use it
  for each edit of an existing file. Use `build` only for a new file.
- `plume-xlsx set --help` lists the style fields and the edits that it
  refuses.

### Prove an edit

1. List the changed cells:

   ```
   plume-xlsx diff <before.xlsx> <after.xlsx>
   ```

   Make sure that it lists only the cells that you meant to change. `diff`
   does not compare styles: read the changed cells with `read --cells` to see
   their `fill`.
2. Check the cells against their data validation:

   ```
   plume-xlsx check <after.xlsx>
   ```

   Exit 0 means that no cell breaks its rule. On exit 1, run `check` on the
   before file too. A broken cell that the before file has is not yours: name
   it in your report.

### Make a new file

- From CSV or TSV: `plume-xlsx csv <in.csv> -o <out.xlsx>`.
  `plume-xlsx csv --help` lists the delimiter and header flags.
- From a JSON Document: `plume-xlsx build <doc.json> -o <out.xlsx>`.
  `plume-xlsx schema` prints the shape of the Document, and
  `plume-xlsx read <file.xlsx>` prints a Document to copy from.
