# Letter Rip

Address and print envelopes from your browser.

Prints addressed envelopes, singly or merged from a spreadsheet list, from a browser. Labels are next. Built for managed Chromebooks where Google Docs is blocked. No server: everything runs on the device and nothing is uploaded.

## Use

1. Open the site.
2. Type the recipient address. The return address is remembered on this device.
3. Choose the envelope size from the list (default #10), or choose **Custom…** and enter the width and height in inches or millimeters. Each side must be 3 to 20 inches.
4. Click **Print envelope**. The PDF opens in a new tab; print it from there. Make sure the printer's paper size matches the envelope and envelopes are loaded in the envelope tray.

Each address box has a toolbar above the text:

- **Font:** the font for that address.
- **Size:** the point size, from 6 to 72. To size selected lines, select text first. With nothing selected, **Size** applies to the whole address.
- **B** and **I:** bold and italic. A button is disabled when the font has no such face, as with script fonts.
- **Alignment:** left, center, or right.

To toggle bold or italic from the keyboard, press Ctrl+B or Ctrl+I (Cmd+B or Cmd+I on a Mac).

When you paste text, the box keeps only bold, italic, and line breaks.

The **From** and **To** switches turn printing on or off for each address.

**Export layout** saves your return address and preferences to `envelope-layout.json`, which you can **Import** on another Chromebook.

## Print many envelopes from a list

To print one envelope per row of a spreadsheet:

1. In the **To** card, choose **From a list**.
2. Drop a CSV, TSV, or Excel file on the panel. Or click **Paste cells** and paste from any spreadsheet.
3. Check the table:
   - Turn **First row is headers** on or off.
   - For sideways sheets, turn on **Headers run down the first column**.
   - To rename a header, click it.
   - To skip a row, clear its checkbox.
4. Under the table, build the address. Click **Insert field** to add a field such as `{{Name}}`. You can put several fields on one line, for example `{{First}} {{Last}}` or `{{City}}, {{State}} {{Zip}}`.
5. To check each envelope, use the ‹ › stepper in the preview. Then click **Print N envelopes**.

Notes:

- Your list stays on the device and isn't saved between sessions. The address template is saved.
- A cell with several lines prints as several lines.
- A line whose fields are all empty is dropped, so a missing second street line leaves no gap.
- **Insert field** is available after you load a list.
- A row with no address text is skipped. The preview shows how many.
- The table shows the first 200 rows. **Select all** and **Clear** apply to every row.
- When you include more than 2,000 rows, the app notes that making the PDF may take a while.

## Fonts

Each address block has its own font. The font picker offers these sources:

- **Standard and bundled fonts:** work offline and need no setup. The build includes 14 bundled fonts. The 12 non-script fonts include bold and italic faces. Great Vibes and Dancing Script have only a regular face.
- **Google Fonts:** a searchable list that appears only when you configure an API key. The app fetches bold and italic faces from Google Fonts when the family has them.
- **Installed on this device:** fonts installed on your computer. This source requires Chrome 103 or later. The first use shows a one-time permission prompt. The app uses the family's Bold and Italic styles when they're installed.

When a font has no bold or italic face, the PDF uses the closest face that exists. It never fakes a style.

Font collections such as `.ttc` files aren't supported.

To enable the Google Fonts search:

1. In Google Cloud, create a Google Fonts Developer API key.
2. Restrict the key to your site's domain with an HTTP referrer restriction.
3. Copy `.env.example` to `.env`.
4. Set `VITE_GOOGLE_FONTS_API_KEY` in `.env` to your key.
5. Run `npm run build`.

The key is embedded in the built site, so the referrer restriction is what protects it.

## Position

Each address block (return and recipient) has a **Position** section under its text box:

- **Anchor:** one of nine positions on a 3×3 grid, measured 0.5 in from the envelope edges.
- **Nudge:** X and Y offsets in inches. Positive X moves the block right. Positive Y moves it down.

To fit envelopes with pre-printed elements such as a logo or a window, use the nudge offsets. The preview shows the result before you print.

## Develop

    npm install
    npm run dev      # local server
    npm test         # unit tests
    npm run check    # type check
    npm run build    # static site in dist/

## Deploy

`npm run build` produces `dist/`. Copy its contents to any static host or any path on an existing site. The build uses relative URLs, so it works at `/`, `/envelopes/`, or a subdomain.

`dist/` includes about 17 MB of bundled fonts, including the bold and italic faces. The browser downloads a face only when an address uses it.

### SEO and sharing

To get canonical and social tags, a `Sitemap:` line in `robots.txt`, and `sitemap.xml`, set `VITE_SITE_URL` in `.env` to the full public URL (for example `https://example.com/letter-rip/`) before you run `npm run build`. When it's empty, the build omits those URL tags and writes `robots.txt` without a sitemap.

To regenerate the social image `public/og.png` after you edit `docs/og-source.html`, run this from the repo root: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot="$PWD/public/og.png" --window-size=1200,630 --hide-scrollbars --allow-file-access-from-files "file://$PWD/docs/og-source.html"`.

## License

Letter Rip is released under the MIT License. See [LICENSE](LICENSE). Bundled fonts, interface fonts, and libraries keep their own licenses, listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
