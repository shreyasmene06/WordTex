using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using System.IO;
using System.Text;
using System.Text.Json;

namespace WordTex.OoxmlEngine.Services;

/// <summary>
/// Core service for reading and writing .docx files using the OpenXML SDK.
/// Handles full document lifecycle: creation, reading, modification, and anchor management.
/// </summary>
public class DocumentService
{
    private readonly ILogger<DocumentService> _logger;

    public DocumentService(ILogger<DocumentService> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Build a .docx file from a SIR JSON representation.
    /// </summary>
    public byte[] BuildDocx(string sirJson, string? templatePath = null)
    {
        using var stream = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(stream, WordprocessingDocumentType.Document, true))
        {
            var mainPart = doc.AddMainDocumentPart();
            mainPart.Document = new Document();
            var body = mainPart.Document.AppendChild(new Body());

            var sir = JsonDocument.Parse(sirJson);
            var root = sir.RootElement;

            // Process metadata
            if (root.TryGetProperty("metadata", out var metadata))
            {
                AddMetadata(doc, metadata);
            }

            // Process body blocks
            if (root.TryGetProperty("body", out var bodyBlocks))
            {
                foreach (var block in bodyBlocks.EnumerateArray())
                {
                    ProcessBlock(body, block, mainPart);
                }
            }

            // Add styles
            AddDefaultStyles(mainPart);

            // Add anchor metadata as Custom XML Part
            if (root.TryGetProperty("anchor_store", out var anchors))
            {
                EmbedAnchors(mainPart, anchors.GetRawText());
            }

            // Set section properties
            AddSectionProperties(body);
        }

        return stream.ToArray();
    }

    /// <summary>
    /// Parse a .docx file into SIR JSON representation.
    /// </summary>
    public string ParseDocx(byte[] docxBytes)
    {
        using var stream = new MemoryStream(docxBytes);
        using var doc = WordprocessingDocument.Open(stream, false);

        var mainPart = doc.MainDocumentPart;
        if (mainPart?.Document?.Body == null)
            throw new InvalidOperationException("Invalid .docx: no body found");

        var result = new Dictionary<string, object>();
        var blocks = new List<Dictionary<string, object>>();

        foreach (var element in mainPart.Document.Body.Elements())
        {
            switch (element)
            {
                case Paragraph para:
                    blocks.Add(ParseParagraph(para));
                    break;
                case Table table:
                    blocks.Add(ParseTable(table));
                    break;
                case SdtBlock sdt:
                    blocks.Add(ParseStructuredDocumentTag(sdt));
                    break;
            }
        }

        result["body"] = blocks;

        // Extract metadata
        if (doc.PackageProperties != null)
        {
            result["metadata"] = ExtractMetadata(doc);
        }

        // Extract anchor store from Custom XML
        var anchors = ExtractAnchors(mainPart);
        if (anchors != null)
        {
            result["anchor_store"] = anchors;
        }

        return JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
    }

    private void ProcessBlock(Body body, JsonElement block, MainDocumentPart mainPart)
    {
        if (!block.TryGetProperty("kind", out var kind))
            return;

        var kindStr = kind.GetString();

        switch (kindStr)
        {
            case "Heading":
                AddHeading(body, block);
                break;
            case "Paragraph":
                AddParagraph(body, block);
                break;
            case "MathBlock":
                AddMathBlock(body, block);
                break;
            case "TableBlock":
                AddTable(body, block);
                break;
            case "Figure":
                AddFigure(body, block, mainPart);
                break;
            case "List":
                AddList(body, block);
                break;
            case "CodeBlock":
                AddCodeBlock(body, block);
                break;
            case "TheoremLike":
                AddTheoremLike(body, block);
                break;
            case "BlockQuote":
                AddBlockQuote(body, block);
                break;
            case "HorizontalRule":
                AddHorizontalRule(body);
                break;
            case "PageBreak":
                AddPageBreak(body);
                break;
            default:
                _logger.LogWarning("Unknown block kind: {Kind}", kindStr);
                break;
        }
    }

    private void AddHeading(Body body, JsonElement block)
    {
        var level = block.TryGetProperty("level", out var l) ? l.GetInt32() : 1;
        var para = new Paragraph();
        var props = new ParagraphProperties(
            new ParagraphStyleId { Val = $"Heading{level}" }
        );
        para.AppendChild(props);

        if (block.TryGetProperty("content", out var content))
        {
            AddInlineContent(para, content);
        }

        body.AppendChild(para);
    }

    private void AddParagraph(Body body, JsonElement block)
    {
        var para = new Paragraph();

        if (block.TryGetProperty("style", out var style))
        {
            var props = new ParagraphProperties();
            ApplyParagraphStyle(props, style);
            para.AppendChild(props);
        }

        if (block.TryGetProperty("content", out var content))
        {
            AddInlineContent(para, content);
        }

        body.AppendChild(para);
    }

    private void AddMathBlock(Body body, JsonElement block)
    {
        // OMML math block in paragraph
        var para = new Paragraph();

        if (block.TryGetProperty("omml", out var omml))
        {
            // Insert raw OMML XML
            var run = new Run(new Text(omml.GetString() ?? "[math]"));
            para.AppendChild(run);
        }
        else if (block.TryGetProperty("latex_source", out var latex))
        {
            // Fallback: render as text with equation markers
            var run = new Run(new Text($"[Equation: {latex.GetString()}]"));
            para.AppendChild(run);
        }

        body.AppendChild(para);
    }

    private void AddTable(Body body, JsonElement block)
    {
        var table = new Table();

        // Table properties
        var tblProps = new TableProperties(
            new TableBorders(
                new TopBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4 },
                new BottomBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4 },
                new LeftBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4 },
                new RightBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4 },
                new InsideHorizontalBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4 },
                new InsideVerticalBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4 }
            ),
            new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct }
        );
        table.AppendChild(tblProps);

        if (block.TryGetProperty("rows", out var rows))
        {
            foreach (var rowEl in rows.EnumerateArray())
            {
                var row = new TableRow();

                if (rowEl.TryGetProperty("cells", out var cells))
                {
                    foreach (var cellEl in cells.EnumerateArray())
                    {
                        var cell = new TableCell();
                        var cellProps = new TableCellProperties();

                        // Handle column span
                        if (cellEl.TryGetProperty("col_span", out var colSpan) && colSpan.GetInt32() > 1)
                        {
                            cellProps.AppendChild(new GridSpan { Val = colSpan.GetInt32() });
                        }

                        // Handle vertical merge (row span)
                        if (cellEl.TryGetProperty("row_span", out var rowSpan) && rowSpan.GetInt32() > 1)
                        {
                            cellProps.AppendChild(new VerticalMerge { Val = MergedCellValues.Restart });
                        }

                        cell.AppendChild(cellProps);

                        var para = new Paragraph();
                        if (cellEl.TryGetProperty("content", out var content))
                        {
                            AddInlineContent(para, content);
                        }
                        cell.AppendChild(para);

                        row.AppendChild(cell);
                    }
                }

                table.AppendChild(row);
            }
        }

        body.AppendChild(table);
    }

    private void AddFigure(Body body, JsonElement block, MainDocumentPart mainPart)
    {
        // Figure with caption
        if (block.TryGetProperty("caption", out var caption))
        {
            var para = new Paragraph();
            var props = new ParagraphProperties(
                new ParagraphStyleId { Val = "Caption" }
            );
            para.AppendChild(props);
            AddInlineContent(para, caption);
            body.AppendChild(para);
        }
    }

    private void AddList(Body body, JsonElement block)
    {
        var ordered = block.TryGetProperty("ordered", out var o) && o.GetBoolean();

        if (block.TryGetProperty("items", out var items))
        {
            foreach (var item in items.EnumerateArray())
            {
                var para = new Paragraph();
                var props = new ParagraphProperties(
                    new ParagraphStyleId { Val = ordered ? "ListNumber" : "ListBullet" },
                    new NumberingProperties(
                        new NumberingLevelReference { Val = 0 },
                        new NumberingId { Val = ordered ? 2 : 1 }
                    )
                );
                para.AppendChild(props);

                if (item.TryGetProperty("content", out var content))
                {
                    AddInlineContent(para, content);
                }

                body.AppendChild(para);
            }
        }
    }

    private void AddCodeBlock(Body body, JsonElement block)
    {
        var para = new Paragraph();
        var props = new ParagraphProperties(
            new ParagraphStyleId { Val = "Code" },
            new Shading { Fill = "F5F5F5" }
        );
        para.AppendChild(props);

        if (block.TryGetProperty("source", out var source))
        {
            var run = new Run();
            var runProps = new RunProperties(
                new RunFonts { Ascii = "Courier New", HighAnsi = "Courier New" },
                new FontSize { Val = "18" }
            );
            run.AppendChild(runProps);
            run.AppendChild(new Text(source.GetString() ?? "") { Space = SpaceProcessingModeValues.Preserve });
            para.AppendChild(run);
        }

        body.AppendChild(para);
    }

    private void AddTheoremLike(Body body, JsonElement block)
    {
        var kind = block.TryGetProperty("theorem_kind", out var k) ? k.GetString() : "Theorem";

        // Theorem header
        var headerPara = new Paragraph();
        var headerRun = new Run();
        headerRun.AppendChild(new RunProperties(new Bold()));
        headerRun.AppendChild(new Text($"{kind}. ") { Space = SpaceProcessingModeValues.Preserve });
        headerPara.AppendChild(headerRun);
        body.AppendChild(headerPara);

        // Theorem body
        if (block.TryGetProperty("content", out var content))
        {
            var para = new Paragraph();
            var run = new Run();
            run.AppendChild(new RunProperties(new Italic()));
            if (content.ValueKind == JsonValueKind.Array)
            {
                AddInlineContent(para, content);
            }
            body.AppendChild(para);
        }
    }

    private void AddBlockQuote(Body body, JsonElement block)
    {
        var para = new Paragraph();
        var props = new ParagraphProperties(
            new Indentation { Left = "720" },
            new ParagraphStyleId { Val = "Quote" }
        );
        para.AppendChild(props);

        if (block.TryGetProperty("content", out var content))
        {
            AddInlineContent(para, content);
        }

        body.AppendChild(para);
    }

    private void AddHorizontalRule(Body body)
    {
        var para = new Paragraph();
        var props = new ParagraphProperties();
        var pBdr = new ParagraphBorders(
            new BottomBorder { Val = BorderValues.Single, Size = 6, Space = 1 }
        );
        props.AppendChild(pBdr);
        para.AppendChild(props);
        body.AppendChild(para);
    }

    private void AddPageBreak(Body body)
    {
        var para = new Paragraph(
            new Run(new Break { Type = BreakValues.Page })
        );
        body.AppendChild(para);
    }

    private void AddInlineContent(Paragraph para, JsonElement content)
    {
        if (content.ValueKind == JsonValueKind.Array)
        {
            foreach (var inline in content.EnumerateArray())
            {
                AddInlineElement(para, inline);
            }
        }
        else if (content.ValueKind == JsonValueKind.String)
        {
            var run = new Run(new Text(content.GetString() ?? "")
            {
                Space = SpaceProcessingModeValues.Preserve
            });
            para.AppendChild(run);
        }
    }

    private void AddInlineElement(Paragraph para, JsonElement inline)
    {
        if (!inline.TryGetProperty("type", out var type))
        {
            // Plain text
            if (inline.TryGetProperty("text", out var text))
            {
                var run = new Run(new Text(text.GetString() ?? "")
                {
                    Space = SpaceProcessingModeValues.Preserve
                });
                para.AppendChild(run);
            }
            return;
        }

        var typeStr = type.GetString();
        switch (typeStr)
        {
            case "Text":
                {
                    var run = new Run();
                    var runProps = new RunProperties();

                    if (inline.TryGetProperty("style", out var style))
                    {
                        ApplyRunStyle(runProps, style);
                    }

                    run.AppendChild(runProps);
                    var textVal = inline.TryGetProperty("text", out var t) ? t.GetString() : "";
                    run.AppendChild(new Text(textVal ?? "") { Space = SpaceProcessingModeValues.Preserve });
                    para.AppendChild(run);
                    break;
                }
            case "InlineMath":
                {
                    // OMML inline math
                    var run = new Run();
                    var textVal = inline.TryGetProperty("latex", out var t) ? t.GetString() : "";
                    run.AppendChild(new Text($"⟨{textVal}⟩") { Space = SpaceProcessingModeValues.Preserve });
                    para.AppendChild(run);
                    break;
                }
            case "Reference":
                {
                    var label = inline.TryGetProperty("label", out var l) ? l.GetString() : "ref";
                    var run = new Run(new Text($"[{label}]") { Space = SpaceProcessingModeValues.Preserve });
                    para.AppendChild(run);
                    break;
                }
            case "Citation":
                {
                    var keys = inline.TryGetProperty("keys", out var k) ? k.GetString() : "cite";
                    var run = new Run(new Text($"[{keys}]") { Space = SpaceProcessingModeValues.Preserve });
                    para.AppendChild(run);
                    break;
                }
            case "Hyperlink":
                {
                    var url = inline.TryGetProperty("url", out var u) ? u.GetString() : "#";
                    var text = inline.TryGetProperty("text", out var t) ? t.GetString() : url;
                    var run = new Run();
                    run.AppendChild(new RunProperties(
                        new Color { Val = "0563C1" },
                        new Underline { Val = UnderlineValues.Single }
                    ));
                    run.AppendChild(new Text(text ?? "") { Space = SpaceProcessingModeValues.Preserve });
                    para.AppendChild(run);
                    break;
                }
            case "FootnoteRef":
                {
                    var run = new Run();
                    run.AppendChild(new RunProperties(new VerticalTextAlignment
                    {
                        Val = VerticalPositionValues.Superscript
                    }));
                    var num = inline.TryGetProperty("number", out var n) ? n.GetInt32().ToString() : "*";
                    run.AppendChild(new Text(num) { Space = SpaceProcessingModeValues.Preserve });
                    para.AppendChild(run);
                    break;
                }
        }
    }

    private void ApplyRunStyle(RunProperties props, JsonElement style)
    {
        if (style.TryGetProperty("bold", out var bold) && bold.GetBoolean())
            props.AppendChild(new Bold());

        if (style.TryGetProperty("italic", out var italic) && italic.GetBoolean())
            props.AppendChild(new Italic());

        if (style.TryGetProperty("underline", out var underline) && underline.GetBoolean())
            props.AppendChild(new Underline { Val = UnderlineValues.Single });

        if (style.TryGetProperty("strikethrough", out var strike) && strike.GetBoolean())
            props.AppendChild(new Strike());

        if (style.TryGetProperty("superscript", out var sup) && sup.GetBoolean())
            props.AppendChild(new VerticalTextAlignment { Val = VerticalPositionValues.Superscript });

        if (style.TryGetProperty("subscript", out var sub) && sub.GetBoolean())
            props.AppendChild(new VerticalTextAlignment { Val = VerticalPositionValues.Subscript });

        if (style.TryGetProperty("small_caps", out var sc) && sc.GetBoolean())
            props.AppendChild(new SmallCaps());

        if (style.TryGetProperty("font_family", out var font))
            props.AppendChild(new RunFonts { Ascii = font.GetString(), HighAnsi = font.GetString() });

        if (style.TryGetProperty("font_size_pt", out var size))
            props.AppendChild(new FontSize { Val = (size.GetDouble() * 2).ToString("F0") });

        if (style.TryGetProperty("color", out var color))
        {
            var hex = color.TryGetProperty("hex", out var h) ? h.GetString() : "000000";
            props.AppendChild(new Color { Val = hex?.TrimStart('#') });
        }
    }

    private void ApplyParagraphStyle(ParagraphProperties props, JsonElement style)
    {
        if (style.TryGetProperty("alignment", out var align))
        {
            var jc = align.GetString() switch
            {
                "Center" => JustificationValues.Center,
                "Right" => JustificationValues.Right,
                "Justify" => JustificationValues.Both,
                _ => JustificationValues.Left,
            };
            props.AppendChild(new Justification { Val = jc });
        }

        if (style.TryGetProperty("line_spacing_pt", out var spacing))
        {
            props.AppendChild(new SpacingBetweenLines
            {
                Line = ((int)(spacing.GetDouble() * 20)).ToString()
            });
        }

        if (style.TryGetProperty("indent_first_line_mm", out var indent))
        {
            var twips = (int)(indent.GetDouble() * 56.7);
            props.AppendChild(new Indentation { FirstLine = twips.ToString() });
        }
    }

    private void AddMetadata(WordprocessingDocument doc, JsonElement metadata)
    {
        var props = doc.PackageProperties;
        if (metadata.TryGetProperty("title", out var title))
            props.Title = title.GetString();
        if (metadata.TryGetProperty("abstract_text", out var abs))
            props.Description = abs.GetString();
    }

    private Dictionary<string, object> ExtractMetadata(WordprocessingDocument doc)
    {
        var result = new Dictionary<string, object>();
        var props = doc.PackageProperties;
        if (props.Title != null) result["title"] = props.Title;
        if (props.Creator != null) result["creator"] = props.Creator;
        if (props.Description != null) result["abstract_text"] = props.Description;
        return result;
    }

    private void AddDefaultStyles(MainDocumentPart mainPart)
    {
        var stylesPart = mainPart.AddNewPart<StyleDefinitionsPart>();
        var styles = new Styles();

        // Heading styles
        for (int i = 1; i <= 6; i++)
        {
            var size = 48 - (i * 4); // Decreasing sizes
            styles.AppendChild(new Style(
                new StyleName { Val = $"heading {i}" },
                new StyleRunProperties(
                    new Bold(),
                    new FontSize { Val = size.ToString() }
                )
            )
            {
                Type = StyleValues.Paragraph,
                StyleId = $"Heading{i}"
            });
        }

        // Code style
        styles.AppendChild(new Style(
            new StyleName { Val = "Code" },
            new StyleRunProperties(
                new RunFonts { Ascii = "Courier New", HighAnsi = "Courier New" },
                new FontSize { Val = "18" }
            ),
            new StyleParagraphProperties(
                new Shading { Fill = "F5F5F5", Val = ShadingPatternValues.Clear }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "Code"
        });

        stylesPart.Styles = styles;
    }

    private void EmbedAnchors(MainDocumentPart mainPart, string anchorsJson)
    {
        var customXml = mainPart.AddCustomXmlPart(CustomXmlPartType.CustomXml);
        var xmlContent = $"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<wordtex:anchors xmlns:wordtex=\"urn:wordtex:anchors:v1\">\n<![CDATA[{anchorsJson}]]>\n</wordtex:anchors>";
        using var writer = new StreamWriter(customXml.GetStream());
        writer.Write(xmlContent);
    }

    private string? ExtractAnchors(MainDocumentPart? mainPart)
    {
        if (mainPart == null) return null;

        foreach (var part in mainPart.CustomXmlParts)
        {
            using var reader = new StreamReader(part.GetStream());
            var content = reader.ReadToEnd();
            if (content.Contains("wordtex:anchors"))
            {
                // Extract CDATA content
                var start = content.IndexOf("<![CDATA[");
                var end = content.IndexOf("]]>");
                if (start >= 0 && end > start)
                {
                    return content.Substring(start + 9, end - start - 9);
                }
            }
        }

        return null;
    }

    private Dictionary<string, object> ParseParagraph(Paragraph para)
    {
        var result = new Dictionary<string, object>();

        // Check for heading style
        var styleId = para.ParagraphProperties?.ParagraphStyleId?.Val?.Value;
        if (styleId != null && styleId.StartsWith("Heading"))
        {
            result["kind"] = "Heading";
            if (int.TryParse(styleId.Replace("Heading", ""), out var level))
                result["level"] = level;
        }
        else
        {
            result["kind"] = "Paragraph";
        }

        // Parse inline content
        var runs = new List<Dictionary<string, object>>();
        foreach (var run in para.Elements<Run>())
        {
            var runDict = new Dictionary<string, object>();
            runDict["type"] = "Text";
            runDict["text"] = run.InnerText;

            var style = new Dictionary<string, object>();
            var rp = run.RunProperties;
            if (rp != null)
            {
                if (rp.Bold != null) style["bold"] = true;
                if (rp.Italic != null) style["italic"] = true;
                if (rp.SmallCaps != null) style["small_caps"] = true;
                if (rp.Strike != null) style["strikethrough"] = true;
                if (rp.RunFonts?.Ascii?.Value != null) style["font_family"] = rp.RunFonts.Ascii.Value;
                if (rp.FontSize?.Val?.Value != null)
                    style["font_size_pt"] = double.Parse(rp.FontSize.Val.Value) / 2.0;
                if (rp.Color?.Val?.Value != null)
                    style["color"] = new Dictionary<string, string> { ["hex"] = rp.Color.Val.Value };
            }
            if (style.Count > 0) runDict["style"] = style;

            runs.Add(runDict);
        }

        result["content"] = runs;
        return result;
    }

    private Dictionary<string, object> ParseTable(Table table)
    {
        var result = new Dictionary<string, object>();
        result["kind"] = "TableBlock";

        var rows = new List<Dictionary<string, object>>();
        foreach (var row in table.Elements<TableRow>())
        {
            var rowDict = new Dictionary<string, object>();
            var cells = new List<Dictionary<string, object>>();

            foreach (var cell in row.Elements<TableCell>())
            {
                var cellDict = new Dictionary<string, object>();
                cellDict["text"] = cell.InnerText;

                var gridSpan = cell.TableCellProperties?.GridSpan?.Val;
                if (gridSpan != null) cellDict["col_span"] = gridSpan.Value;

                cells.Add(cellDict);
            }

            rowDict["cells"] = cells;
            rows.Add(rowDict);
        }

        result["rows"] = rows;
        return result;
    }

    private Dictionary<string, object> ParseStructuredDocumentTag(SdtBlock sdt)
    {
        return new Dictionary<string, object>
        {
            ["kind"] = "Paragraph",
            ["content"] = new List<Dictionary<string, object>>
            {
                new() { ["type"] = "Text", ["text"] = sdt.InnerText }
            }
        };
    }

    private void AddSectionProperties(Body body)
    {
        var sectProps = new SectionProperties(
            new PageSize
            {
                Width = 12240, // 8.5 inches (Letter)
                Height = 15840, // 11 inches
                Orient = PageOrientationValues.Portrait
            },
            new PageMargin
            {
                Top = 1440,    // 1 inch
                Right = 1440,
                Bottom = 1440,
                Left = 1440,
                Header = 720,
                Footer = 720,
                Gutter = 0
            },
            new Columns { Space = "720" }
        );
        body.AppendChild(sectProps);
    }
}
