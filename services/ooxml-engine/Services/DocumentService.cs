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
        level = Math.Clamp(level, 1, 6);
        var para = new Paragraph();
        var props = new ParagraphProperties(
            new ParagraphStyleId { Val = $"Heading{level}" },
            new KeepNext(),
            new KeepLines()
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
        var props = new ParagraphProperties();
        bool hasExplicitStyle = false;

        if (block.TryGetProperty("style", out var style))
        {
            ApplyParagraphStyle(props, style);
            hasExplicitStyle = true;
        }

        // Apply the Normal style by default if no explicit style
        if (!hasExplicitStyle)
        {
            props.AppendChild(new ParagraphStyleId { Val = "Normal" });
        }

        para.AppendChild(props);

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

        // Table properties with professional styling
        var tblProps = new TableProperties(
            new TableBorders(
                new TopBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4, Color = "404040" },
                new BottomBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4, Color = "404040" },
                new LeftBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4, Color = "404040" },
                new RightBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4, Color = "404040" },
                new InsideHorizontalBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4, Color = "BFBFBF" },
                new InsideVerticalBorder { Val = new EnumValue<BorderValues>(BorderValues.Single), Size = 4, Color = "BFBFBF" }
            ),
            new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct },
            new TableCellMarginDefault(
                new TopMargin { Width = "40", Type = TableWidthUnitValues.Dxa },
                new StartMargin { Width = "80", Type = TableWidthUnitValues.Dxa },
                new BottomMargin { Width = "40", Type = TableWidthUnitValues.Dxa },
                new EndMargin { Width = "80", Type = TableWidthUnitValues.Dxa }
            ),
            new TableLook { Val = "04A0", FirstRow = true, LastRow = false, FirstColumn = true, LastColumn = false, NoHorizontalBand = false, NoVerticalBand = true }
        );
        table.AppendChild(tblProps);

        if (block.TryGetProperty("rows", out var rows))
        {
            bool isFirstRow = true;
            foreach (var rowEl in rows.EnumerateArray())
            {
                var row = new TableRow();
                bool isHeader = (rowEl.TryGetProperty("is_header", out var hdr) && hdr.GetBoolean()) || isFirstRow;

                if (isHeader)
                {
                    var rowProps = new TableRowProperties(new TableHeader());
                    row.AppendChild(rowProps);
                }

                if (rowEl.TryGetProperty("cells", out var cells))
                {
                    foreach (var cellEl in cells.EnumerateArray())
                    {
                        var cell = new TableCell();
                        var cellProps = new TableCellProperties();

                        // Vertical alignment
                        cellProps.AppendChild(new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center });

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

                        // Header row shading
                        if (isHeader)
                        {
                            cellProps.AppendChild(new Shading { Fill = "F2F2F2", Val = ShadingPatternValues.Clear, Color = "auto" });
                        }

                        cell.AppendChild(cellProps);

                        var para = new Paragraph();
                        var paraProps = new ParagraphProperties(
                            new SpacingBetweenLines { Before = "0", After = "0", Line = "240", LineRule = LineSpacingRuleValues.Auto }
                        );

                        if (isHeader)
                        {
                            // Bold text for header cells
                            paraProps.AppendChild(new Justification { Val = JustificationValues.Center });
                        }

                        para.AppendChild(paraProps);

                        if (cellEl.TryGetProperty("content", out var content))
                        {
                            if (isHeader)
                            {
                                // Wrap header cell content in bold runs
                                if (content.ValueKind == JsonValueKind.Array)
                                {
                                    foreach (var inline in content.EnumerateArray())
                                    {
                                        var run = new Run();
                                        var runProps = new RunProperties(new Bold(), new BoldComplexScript());
                                        run.AppendChild(runProps);
                                        var textVal = inline.TryGetProperty("text", out var t) ? t.GetString() : "";
                                        run.AppendChild(new Text(textVal ?? "") { Space = SpaceProcessingModeValues.Preserve });
                                        para.AppendChild(run);
                                    }
                                }
                                else if (content.ValueKind == JsonValueKind.String)
                                {
                                    var run = new Run();
                                    run.AppendChild(new RunProperties(new Bold(), new BoldComplexScript()));
                                    run.AppendChild(new Text(content.GetString() ?? "") { Space = SpaceProcessingModeValues.Preserve });
                                    para.AppendChild(run);
                                }
                            }
                            else
                            {
                                AddInlineContent(para, content);
                            }
                        }
                        cell.AppendChild(para);

                        row.AppendChild(cell);
                    }
                }

                table.AppendChild(row);
                isFirstRow = false;
            }
        }

        // Add empty paragraph after table for spacing
        body.AppendChild(table);
        body.AppendChild(new Paragraph(new ParagraphProperties(
            new SpacingBetweenLines { Before = "0", After = "120" }
        )));
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
            AddListItems(body, items, ordered, 0);
        }
    }

    private void AddListItems(Body body, JsonElement items, bool ordered, int level)
    {
        foreach (var item in items.EnumerateArray())
        {
            var para = new Paragraph();
            var indentLeft = (360 * (level + 1)).ToString();
            var hanging = "360";

            var props = new ParagraphProperties(
                new ParagraphStyleId { Val = ordered ? "ListNumber" : "ListBullet" },
                new NumberingProperties(
                    new NumberingLevelReference { Val = level },
                    new NumberingId { Val = ordered ? 2 : 1 }
                ),
                new SpacingBetweenLines { Before = "20", After = "20", Line = "264", LineRule = LineSpacingRuleValues.Auto },
                new Indentation { Left = indentLeft, Hanging = hanging }
            );
            para.AppendChild(props);

            if (item.TryGetProperty("content", out var content))
            {
                AddInlineContent(para, content);
            }
            else if (item.ValueKind == JsonValueKind.String)
            {
                var run = new Run(new Text(item.GetString() ?? "") { Space = SpaceProcessingModeValues.Preserve });
                para.AppendChild(run);
            }

            body.AppendChild(para);

            // Handle nested sub-lists
            if (item.TryGetProperty("sub_items", out var subItems))
            {
                var subOrdered = item.TryGetProperty("sub_ordered", out var so) && so.GetBoolean();
                AddListItems(body, subItems, subOrdered, level + 1);
            }
        }
    }

    private void AddCodeBlock(Body body, JsonElement block)
    {
        var para = new Paragraph();
        var props = new ParagraphProperties(
            new ParagraphStyleId { Val = "Code" },
            new Shading { Fill = "F8F9FA", Val = ShadingPatternValues.Clear, Color = "auto" }
        );
        para.AppendChild(props);

        if (block.TryGetProperty("source", out var source))
        {
            var sourceText = source.GetString() ?? "";
            // Split by newlines and insert Break elements for multi-line code
            var codeLines = sourceText.Split('\n');
            for (int idx = 0; idx < codeLines.Length; idx++)
            {
                var run = new Run();
                var runProps = new RunProperties(
                    new RunFonts { Ascii = "Consolas", HighAnsi = "Consolas", ComplexScript = "Consolas" },
                    new FontSize { Val = "18" },
                    new FontSizeComplexScript { Val = "18" }
                );
                run.AppendChild(runProps);
                run.AppendChild(new Text(codeLines[idx]) { Space = SpaceProcessingModeValues.Preserve });
                para.AppendChild(run);

                if (idx < codeLines.Length - 1)
                {
                    var breakRun = new Run(new Break());
                    para.AppendChild(breakRun);
                }
            }
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
                "Center" or "center" => JustificationValues.Center,
                "Right" or "right" => JustificationValues.Right,
                "Justify" or "justify" => JustificationValues.Both,
                _ => JustificationValues.Left,
            };
            props.AppendChild(new Justification { Val = jc });
        }

        // Line spacing
        if (style.TryGetProperty("line_spacing_pt", out var spacing))
        {
            props.AppendChild(new SpacingBetweenLines
            {
                Line = ((int)(spacing.GetDouble() * 20)).ToString(),
                LineRule = LineSpacingRuleValues.Auto
            });
        }

        // Space before / after paragraph
        if (style.TryGetProperty("space_before_pt", out var spaceBefore) ||
            style.TryGetProperty("space_after_pt", out var spaceAfter))
        {
            var spacingEl = new SpacingBetweenLines();
            if (style.TryGetProperty("space_before_pt", out var sb))
                spacingEl.Before = ((int)(sb.GetDouble() * 20)).ToString();
            if (style.TryGetProperty("space_after_pt", out var sa))
                spacingEl.After = ((int)(sa.GetDouble() * 20)).ToString();
            props.AppendChild(spacingEl);
        }

        // First-line indent
        if (style.TryGetProperty("indent_first_line_mm", out var indent))
        {
            var twips = (int)(indent.GetDouble() * 56.7);
            props.AppendChild(new Indentation { FirstLine = twips.ToString() });
        }

        // Left indent
        if (style.TryGetProperty("indent_left_mm", out var leftIndent))
        {
            var twips = (int)(leftIndent.GetDouble() * 56.7);
            props.AppendChild(new Indentation { Left = twips.ToString() });
        }

        // Keep with next
        if (style.TryGetProperty("keep_with_next", out var kwn) && kwn.GetBoolean())
        {
            props.AppendChild(new KeepNext());
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

        // Document defaults — sets baseline font and spacing for the entire document
        var docDefaults = new DocDefaults(
            new RunPropertiesDefault(
                new RunPropertiesBaseStyle(
                    new RunFonts
                    {
                        Ascii = "Calibri",
                        HighAnsi = "Calibri",
                        EastAsia = "Calibri",
                        ComplexScript = "Calibri"
                    },
                    new FontSize { Val = "22" },        // 11pt
                    new FontSizeComplexScript { Val = "22" },
                    new Languages { Val = "en-US" }
                )
            ),
            new ParagraphPropertiesDefault(
                new ParagraphPropertiesBaseStyle(
                    new SpacingBetweenLines
                    {
                        After = "0",
                        Before = "0",
                        Line = "240",    // single spacing (240 twips = 12pt)
                        LineRule = LineSpacingRuleValues.Auto
                    }
                )
            )
        );
        styles.AppendChild(docDefaults);

        // Normal style — body text baseline
        var normalStyle = new Style(
            new StyleName { Val = "Normal" },
            new PrimaryStyle(),
            new StyleParagraphProperties(
                new SpacingBetweenLines
                {
                    After = "120",   // 6pt after each paragraph
                    Before = "0",
                    Line = "276",    // 1.15× line spacing
                    LineRule = LineSpacingRuleValues.Auto
                },
                new Justification { Val = JustificationValues.Both }
            ),
            new StyleRunProperties(
                new RunFonts
                {
                    Ascii = "Calibri",
                    HighAnsi = "Calibri",
                    EastAsia = "Calibri",
                    ComplexScript = "Calibri"
                },
                new FontSize { Val = "22" },        // 11pt
                new FontSizeComplexScript { Val = "22" }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "Normal",
            Default = true
        };
        styles.AppendChild(normalStyle);

        // Heading sizes in half-points and before/after spacing in twips
        var headingDefs = new (int Level, string SizePt, string Before, string After, bool AllCaps)[]
        {
            (1, "32", "360", "120", false),   // 16pt, 18pt before, 6pt after
            (2, "28", "240", "80", false),    // 14pt, 12pt before, 4pt after
            (3, "24", "200", "60", false),    // 12pt, 10pt before, 3pt after
            (4, "22", "160", "40", false),    // 11pt, 8pt before, 2pt after
            (5, "22", "160", "40", false),    // 11pt
            (6, "20", "120", "40", false),    // 10pt
        };

        foreach (var h in headingDefs)
        {
            var headingStyle = new Style(
                new StyleName { Val = $"heading {h.Level}" },
                new BasedOn { Val = "Normal" },
                new NextParagraphStyle { Val = "Normal" },
                new PrimaryStyle(),
                new StyleParagraphProperties(
                    new KeepNext(),
                    new KeepLines(),
                    new SpacingBetweenLines
                    {
                        Before = h.Before,
                        After = h.After,
                        Line = "240",
                        LineRule = LineSpacingRuleValues.Auto
                    }
                ),
                new StyleRunProperties(
                    new Bold(),
                    new BoldComplexScript(),
                    new RunFonts
                    {
                        Ascii = "Calibri",
                        HighAnsi = "Calibri",
                        EastAsia = "Calibri",
                        ComplexScript = "Calibri"
                    },
                    new FontSize { Val = h.SizePt },
                    new FontSizeComplexScript { Val = h.SizePt },
                    new Color { Val = "1F2937" }
                )
            )
            {
                Type = StyleValues.Paragraph,
                StyleId = $"Heading{h.Level}"
            };
            styles.AppendChild(headingStyle);
        }

        // ListBullet style
        styles.AppendChild(new Style(
            new StyleName { Val = "List Bullet" },
            new BasedOn { Val = "Normal" },
            new StyleParagraphProperties(
                new SpacingBetweenLines { After = "40", Before = "0" },
                new Indentation { Left = "720", Hanging = "360" }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "ListBullet"
        });

        // ListNumber style
        styles.AppendChild(new Style(
            new StyleName { Val = "List Number" },
            new BasedOn { Val = "Normal" },
            new StyleParagraphProperties(
                new SpacingBetweenLines { After = "40", Before = "0" },
                new Indentation { Left = "720", Hanging = "360" }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "ListNumber"
        });

        // Code style
        styles.AppendChild(new Style(
            new StyleName { Val = "Code" },
            new BasedOn { Val = "Normal" },
            new StyleRunProperties(
                new RunFonts { Ascii = "Consolas", HighAnsi = "Consolas", ComplexScript = "Consolas" },
                new FontSize { Val = "18" },
                new FontSizeComplexScript { Val = "18" }
            ),
            new StyleParagraphProperties(
                new Shading { Fill = "F5F5F5", Val = ShadingPatternValues.Clear },
                new SpacingBetweenLines { Before = "80", After = "80", Line = "240" },
                new Justification { Val = JustificationValues.Left }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "Code"
        });

        // Quote style
        styles.AppendChild(new Style(
            new StyleName { Val = "Quote" },
            new BasedOn { Val = "Normal" },
            new StyleParagraphProperties(
                new Indentation { Left = "720", Right = "720" },
                new SpacingBetweenLines { Before = "120", After = "120" }
            ),
            new StyleRunProperties(
                new Italic(),
                new Color { Val = "404040" }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "Quote"
        });

        // Caption style
        styles.AppendChild(new Style(
            new StyleName { Val = "caption" },
            new BasedOn { Val = "Normal" },
            new StyleParagraphProperties(
                new Justification { Val = JustificationValues.Center },
                new SpacingBetweenLines { Before = "60", After = "120" }
            ),
            new StyleRunProperties(
                new FontSize { Val = "18" },
                new FontSizeComplexScript { Val = "18" },
                new Color { Val = "595959" }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "Caption"
        });

        // Abstract style
        styles.AppendChild(new Style(
            new StyleName { Val = "Abstract" },
            new BasedOn { Val = "Normal" },
            new StyleParagraphProperties(
                new Indentation { Left = "720", Right = "720" },
                new Justification { Val = JustificationValues.Both },
                new SpacingBetweenLines { Before = "120", After = "120", Line = "260" }
            ),
            new StyleRunProperties(
                new FontSize { Val = "20" },
                new FontSizeComplexScript { Val = "20" }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "Abstract"
        });

        // Hyperlink character style
        styles.AppendChild(new Style(
            new StyleName { Val = "Hyperlink" },
            new StyleRunProperties(
                new Color { Val = "0563C1" },
                new Underline { Val = UnderlineValues.Single }
            )
        )
        {
            Type = StyleValues.Character,
            StyleId = "Hyperlink"
        });

        stylesPart.Styles = styles;

        // Add numbering definitions for lists
        AddNumberingDefinitions(mainPart);
    }

    private void AddNumberingDefinitions(MainDocumentPart mainPart)
    {
        var numberingPart = mainPart.AddNewPart<NumberingDefinitionsPart>();
        var numbering = new Numbering();

        // Abstract numbering 0 — bullet list
        var absBullet = new AbstractNum(
            new Level(
                new StartNumberingValue { Val = 1 },
                new NumberingFormat { Val = NumberFormatValues.Bullet },
                new LevelText { Val = "\u2022" },  // bullet character
                new LevelJustification { Val = LevelJustificationValues.Left },
                new ParagraphProperties(
                    new Indentation { Left = "720", Hanging = "360" }
                ),
                new NumberingSymbolRunProperties(
                    new RunFonts { Ascii = "Symbol", HighAnsi = "Symbol" }
                )
            ) { LevelIndex = 0 }
        ) { AbstractNumberId = 0 };
        numbering.AppendChild(absBullet);

        // Abstract numbering 1 — decimal numbered list
        var absNumber = new AbstractNum(
            new Level(
                new StartNumberingValue { Val = 1 },
                new NumberingFormat { Val = NumberFormatValues.Decimal },
                new LevelText { Val = "%1." },
                new LevelJustification { Val = LevelJustificationValues.Left },
                new ParagraphProperties(
                    new Indentation { Left = "720", Hanging = "360" }
                )
            ) { LevelIndex = 0 }
        ) { AbstractNumberId = 1 };
        numbering.AppendChild(absNumber);

        // Numbering instance 1 → bullets
        numbering.AppendChild(new NumberingInstance(
            new AbstractNumId { Val = 0 }
        ) { NumberID = 1 });

        // Numbering instance 2 → decimal
        numbering.AppendChild(new NumberingInstance(
            new AbstractNumId { Val = 1 }
        ) { NumberID = 2 });

        numberingPart.Numbering = numbering;
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
                Width = 12240,  // 8.5 inches (Letter)
                Height = 15840, // 11 inches
                Orient = PageOrientationValues.Portrait
            },
            new PageMargin
            {
                Top = 1080,     // 0.75 inch — tighter for professional docs
                Right = 1080,
                Bottom = 1080,
                Left = 1080,
                Header = 540,
                Footer = 540,
                Gutter = 0
            }
        );
        body.AppendChild(sectProps);
    }
}
