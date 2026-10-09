import { describe, it, expect } from 'vitest';
import { domToRich, richToDom, sanitizePasteHtml, plainToPasteHtml } from '../src/lib/richtext-dom';
import { htmlToRich, normalizeRich, type RichText } from '../src/lib/richtext';

describe('domToRich and richToDom', () => {
  it('reads an element through its innerHTML', () => {
    const root = { innerHTML: '<div>Jane <b>Doe</b></div><div data-size="18" style="font-size:18pt">Main St</div>' };
    expect(domToRich(root)).toEqual({
      lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] }, { runs: [{ text: 'Main St' }], size: 18 }],
    });
  });

  it('writes canonical HTML into an element and reads it back', () => {
    const rich: RichText = {
      lines: [{ runs: [{ text: 'Jane ' }, { text: 'Doe', bold: true }] }, { runs: [] }, { runs: [{ text: 'St', italic: true }], size: 24 }],
    };
    const root = { innerHTML: 'old' };
    richToDom(rich, root);
    expect(root.innerHTML).toBe('<div>Jane <b>Doe</b></div><div><br></div><div data-size="24" style="font-size:24pt"><i>St</i></div>');
    expect(domToRich(root)).toEqual(rich);
  });
});

const WORD_PASTE = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=Generator content="Microsoft Word 15">
<!--[if gte mso 9]><xml>
 <o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings>
</xml><![endif]-->
<style>
<!--
 p.MsoNormal {margin:0in; font-size:12.0pt; font-family:"Calibri",sans-serif;}
-->
</style>
</head>
<body lang=EN-US style='tab-interval:.5in'>
<!--StartFragment-->
<p class=MsoNormal><b><span style='font-size:14.0pt;color:#C00000'>Jane
Doe<o:p></o:p></span></b></p>
<p class=MsoNormal style='margin-left:.5in;text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span
style='font-family:Symbol'><span style='mso-list:Ignore'>·<span
style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
</span></span></span><![endif]><i>123 Main&nbsp;St</i> <u>Apt</u> 4<o:p></o:p></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<p class=MsoNormal><span style="font-family:&quot;Georgia&quot;,serif">Springfield, IL&nbsp;62704</span></p>
<!--EndFragment-->
</body>
</html>`;

const DOCS_PASTE =
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;font-style:normal;">Jane Doe</span></p><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:400;font-style:italic;">123 Main St</span><span style="font-size:11pt;font-weight:400;font-style:normal;">, Apt 4</span></p><br></b>';

describe('sanitizePasteHtml', () => {
  it('reduces a Word paste to lines, bold, and italic', () => {
    const out = sanitizePasteHtml(WORD_PASTE);
    expect(out).toBe('<b>Jane Doe</b><br><i>123 Main St</i> Apt 4<br><br>Springfield, IL 62704');
  });

  it('drops Word list markers marked mso-list:Ignore', () => {
    const out = sanitizePasteHtml(
      `<p><span style='mso-list:Ignore'>1.<span>&nbsp;&nbsp;</span></span>First</p>`,
    );
    expect(out).toBe('First');
  });

  it('reduces a Google Docs paste, honoring font-weight:normal on the wrapper', () => {
    expect(sanitizePasteHtml(DOCS_PASTE)).toBe('<b>Jane Doe</b><br><i>123 Main St</i>, Apt 4');
  });

  it('drops styles, classes, links, images, sizes, and tables down to text', () => {
    expect(
      sanitizePasteHtml(
        '<div data-size="30" style="font-size:30px;color:red" class="x"><a href="https://example.com" onclick="evil()">Link</a><img src=x onerror=alert(1)> text</div>',
      ),
    ).toBe('Link text');
  });

  it('keeps line breaks from div, p, br, and li', () => {
    expect(sanitizePasteHtml('<div>a</div><p>b</p>c<br>d<ul><li>e</li><li><strong>f</strong></li></ul>')).toBe(
      'a<br>b<br>c<br>d<br>e<br><b>f</b>',
    );
  });

  it('escapes text so pasted markup stays text', () => {
    expect(sanitizePasteHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</p>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; co',
    );
  });

  it('drops leading and trailing blank lines but keeps interior ones', () => {
    expect(sanitizePasteHtml('<br><p>&nbsp;</p><p>a</p><p></p><br><p>b</p><br><br>')).toBe('a<br><br>b');
  });

  it('returns an empty string for nothing useful', () => {
    expect(sanitizePasteHtml('<style>x{}</style><p> </p>')).toBe('');
  });

  it('produces HTML that parses to the same lines and styles', () => {
    expect(htmlToRich(sanitizePasteHtml(DOCS_PASTE))).toEqual({
      lines: [
        { runs: [{ text: 'Jane Doe', bold: true }] },
        { runs: [{ text: '123 Main St', italic: true }, { text: ', Apt 4' }] },
      ],
    });
  });
});

describe('sanitizePasteHtml edge spaces', () => {
  it('keeps a leading space of a fragment pasted mid-line', () => {
    expect(sanitizePasteHtml('<span> foo</span>')).toBe('&nbsp;foo');
  });

  it('keeps a trailing space of a fragment', () => {
    expect(sanitizePasteHtml('foo <b>bar </b>')).toBe('foo <b>bar&nbsp;</b>');
  });

  it('keeps the style of a preserved edge space', () => {
    expect(htmlToRich(sanitizePasteHtml('<b> foo</b>'))).toEqual({ lines: [{ runs: [{ text: ' foo', bold: true }] }] });
  });

  it('still collapses runs of whitespace at the edges to one space', () => {
    expect(sanitizePasteHtml('  \n foo \t ')).toBe('&nbsp;foo&nbsp;');
  });

  it('keeps edge spaces only on the first and last lines of a multi-line fragment', () => {
    expect(sanitizePasteHtml(' a <br> b <br> c ')).toBe('&nbsp;a<br>b<br>c&nbsp;');
  });

  it('drops blank outer lines and whitespace around block elements', () => {
    expect(sanitizePasteHtml(' <p> a </p> ')).toBe('a');
    expect(sanitizePasteHtml('<br> <br>x ')).toBe('x&nbsp;');
  });

  it('returns an empty string for whitespace only', () => {
    expect(sanitizePasteHtml('   ')).toBe('');
  });
});

describe('normalizeRich on paste fixtures', () => {
  it('is idempotent', () => {
    for (const html of [WORD_PASTE, DOCS_PASTE]) {
      const once = normalizeRich(htmlToRich(html));
      expect(normalizeRich(once)).toEqual(once);
    }
  });
});

describe('plainToPasteHtml', () => {
  it('escapes text and turns newlines into <br>', () => {
    expect(plainToPasteHtml('A & <B>\r\n\n  x')).toBe('A &amp; &lt;B&gt;<br><br>x');
  });

  it('drops leading and trailing blank lines', () => {
    expect(plainToPasteHtml('\n\na\n\n')).toBe('a');
  });
});
