using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace WordTex.OoxmlEngine.Services;

/// <summary>
/// Manages Word styles, ensuring template fidelity by mapping SIR styles
/// to OOXML style definitions exactly matching the target template.
/// </summary>
public class StyleService
{
    private readonly ILogger<StyleService> _logger;

    // Academic template style mappings
    private static readonly Dictionary<string, TemplateStyleMap> Templates = new()
    {
        ["IEEEtran"] = new TemplateStyleMap
        {
            BodyFontFamily = "Times New Roman",
            BodyFontSizePt = 10,
            BodyLineSpacing = 240,        // single
            BodySpacingAfterPt = 0,
            HeadingFontFamily = "Helvetica",
            HeadingFonts = new() { [1] = ("Helvetica", 24), [2] = ("Helvetica", 18), [3] = ("Helvetica", 14) },
            HeadingSpacingBefore = new() { [1] = 240, [2] = 180, [3] = 120 },
            HeadingSpacingAfter = new() { [1] = 120, [2] = 80, [3] = 60 },
            Columns = 2,
            PageWidth = 8.5,
            PageHeight = 11.0,
            MarginTop = 0.75,
            MarginBottom = 1.0,
            MarginLeft = 0.625,
            MarginRight = 0.625,
            Justify = true,
        },
        ["acmart"] = new TemplateStyleMap
        {
            BodyFontFamily = "Linux Libertine",
            BodyFontSizePt = 10,
            BodyLineSpacing = 240,
            BodySpacingAfterPt = 0,
            HeadingFontFamily = "Linux Libertine",
            HeadingFonts = new() { [1] = ("Linux Libertine", 17), [2] = ("Linux Libertine", 12), [3] = ("Linux Libertine", 10) },
            HeadingSpacingBefore = new() { [1] = 240, [2] = 160, [3] = 120 },
            HeadingSpacingAfter = new() { [1] = 100, [2] = 80, [3] = 60 },
            Columns = 2,
            PageWidth = 8.5,
            PageHeight = 11.0,
            MarginTop = 1.18,
            MarginBottom = 0.83,
            MarginLeft = 0.81,
            MarginRight = 0.81,
            Justify = true,
        },
        ["elsarticle"] = new TemplateStyleMap
        {
            BodyFontFamily = "Times New Roman",
            BodyFontSizePt = 12,
            BodyLineSpacing = 276,       // 1.15×
            BodySpacingAfterPt = 120,
            HeadingFontFamily = "Helvetica",
            HeadingFonts = new() { [1] = ("Helvetica", 17), [2] = ("Helvetica", 11), [3] = ("Helvetica", 10) },
            HeadingSpacingBefore = new() { [1] = 360, [2] = 240, [3] = 180 },
            HeadingSpacingAfter = new() { [1] = 120, [2] = 80, [3] = 60 },
            Columns = 1,
            PageWidth = 8.27, // A4
            PageHeight = 11.69,
            MarginTop = 1.0,
            MarginBottom = 1.0,
            MarginLeft = 1.0,
            MarginRight = 1.0,
            Justify = true,
        },
        ["article"] = new TemplateStyleMap
        {
            BodyFontFamily = "Calibri",
            BodyFontSizePt = 11,
            BodyLineSpacing = 276,
            BodySpacingAfterPt = 120,
            HeadingFontFamily = "Calibri",
            HeadingFonts = new() { [1] = ("Calibri", 16), [2] = ("Calibri", 14), [3] = ("Calibri", 12) },
            HeadingSpacingBefore = new() { [1] = 360, [2] = 240, [3] = 200 },
            HeadingSpacingAfter = new() { [1] = 120, [2] = 80, [3] = 60 },
            Columns = 1,
            PageWidth = 8.5,
            PageHeight = 11.0,
            MarginTop = 1.0,
            MarginBottom = 1.0,
            MarginLeft = 1.0,
            MarginRight = 1.0,
            Justify = true,
        },
        ["resume"] = new TemplateStyleMap
        {
            BodyFontFamily = "Calibri",
            BodyFontSizePt = 10,
            BodyLineSpacing = 240,       // single spacing for dense resume
            BodySpacingAfterPt = 40,
            HeadingFontFamily = "Calibri",
            HeadingFonts = new() { [1] = ("Calibri", 18), [2] = ("Calibri", 12), [3] = ("Calibri", 11) },
            HeadingSpacingBefore = new() { [1] = 200, [2] = 160, [3] = 100 },
            HeadingSpacingAfter = new() { [1] = 60, [2] = 40, [3] = 20 },
            Columns = 1,
            PageWidth = 8.5,
            PageHeight = 11.0,
            MarginTop = 0.5,
            MarginBottom = 0.5,
            MarginLeft = 0.55,
            MarginRight = 0.55,
            Justify = false,
        },
    };

    public StyleService(ILogger<StyleService> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Apply a template's styles to a document's style definitions part.
    /// </summary>
    public void ApplyTemplate(StyleDefinitionsPart stylesPart, string templateName)
    {
        if (!Templates.TryGetValue(templateName, out var template))
        {
            _logger.LogWarning("Unknown template {Template}, using article defaults", templateName);
            template = Templates["article"];
        }

        var styles = stylesPart.Styles ?? new Styles();

        // Normal style (body text) with proper line spacing
        var normalStyle = new Style(
            new StyleName { Val = "Normal" },
            new PrimaryStyle(),
            new StyleParagraphProperties(
                new SpacingBetweenLines
                {
                    After = template.BodySpacingAfterPt.ToString(),
                    Before = "0",
                    Line = template.BodyLineSpacing.ToString(),
                    LineRule = LineSpacingRuleValues.Auto
                },
                template.Justify
                    ? new Justification { Val = JustificationValues.Both }
                    : new Justification { Val = JustificationValues.Left }
            ),
            new StyleRunProperties(
                new RunFonts { Ascii = template.BodyFontFamily, HighAnsi = template.BodyFontFamily, ComplexScript = template.BodyFontFamily },
                new FontSize { Val = (template.BodyFontSizePt * 2).ToString() },
                new FontSizeComplexScript { Val = (template.BodyFontSizePt * 2).ToString() }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "Normal",
            Default = true
        };
        styles.AppendChild(normalStyle);

        // Heading styles with proper spacing
        foreach (var (level, (font, size)) in template.HeadingFonts)
        {
            var spacingBefore = template.HeadingSpacingBefore.GetValueOrDefault(level, 240).ToString();
            var spacingAfter = template.HeadingSpacingAfter.GetValueOrDefault(level, 120).ToString();

            var headingStyle = new Style(
                new StyleName { Val = $"heading {level}" },
                new BasedOn { Val = "Normal" },
                new NextParagraphStyle { Val = "Normal" },
                new PrimaryStyle(),
                new StyleRunProperties(
                    new Bold(),
                    new BoldComplexScript(),
                    new RunFonts { Ascii = font, HighAnsi = font, ComplexScript = font },
                    new FontSize { Val = (size * 2).ToString() },
                    new FontSizeComplexScript { Val = (size * 2).ToString() },
                    new Color { Val = "1F2937" }
                ),
                new StyleParagraphProperties(
                    new SpacingBetweenLines
                    {
                        Before = spacingBefore,
                        After = spacingAfter,
                        Line = "240",
                        LineRule = LineSpacingRuleValues.Auto
                    },
                    new KeepNext(),
                    new KeepLines()
                )
            )
            {
                Type = StyleValues.Paragraph,
                StyleId = $"Heading{level}"
            };
            styles.AppendChild(headingStyle);
        }

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
                new FontSize { Val = ((template.BodyFontSizePt - 1) * 2).ToString() },
                new FontSizeComplexScript { Val = ((template.BodyFontSizePt - 1) * 2).ToString() }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "Abstract"
        });

        // Caption style
        styles.AppendChild(new Style(
            new StyleName { Val = "caption" },
            new BasedOn { Val = "Normal" },
            new StyleRunProperties(
                new FontSize { Val = ((template.BodyFontSizePt - 2) * 2).ToString() },
                new FontSizeComplexScript { Val = ((template.BodyFontSizePt - 2) * 2).ToString() },
                new Color { Val = "595959" }
            ),
            new StyleParagraphProperties(
                new Justification { Val = JustificationValues.Center },
                new SpacingBetweenLines { Before = "60", After = "120" }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "Caption"
        });

        stylesPart.Styles = styles;
    }

    /// <summary>
    /// Get section properties (page size, margins, columns) for a template.
    /// </summary>
    public SectionProperties GetSectionProperties(string templateName)
    {
        if (!Templates.TryGetValue(templateName, out var template))
            template = Templates["article"];

        var width = (uint)(template.PageWidth * 1440);
        var height = (uint)(template.PageHeight * 1440);

        var sectProps = new SectionProperties(
            new PageSize
            {
                Width = width,
                Height = height,
                Orient = PageOrientationValues.Portrait
            },
            new PageMargin
            {
                Top = (int)(template.MarginTop * 1440),
                Right = (uint)(template.MarginRight * 1440),
                Bottom = (int)(template.MarginBottom * 1440),
                Left = (uint)(template.MarginLeft * 1440),
                Header = 720,
                Footer = 720,
                Gutter = 0
            }
        );

        if (template.Columns > 1)
        {
            sectProps.AppendChild(new Columns
            {
                ColumnCount = (Int16Value)template.Columns,
                Space = "720",
                EqualWidth = true
            });
        }

        return sectProps;
    }
}

public class TemplateStyleMap
{
    public string BodyFontFamily { get; set; } = "Calibri";
    public int BodyFontSizePt { get; set; } = 11;
    public int BodyLineSpacing { get; set; } = 276;          // twips: 240=single, 276=1.15×, 360=1.5×, 480=double
    public int BodySpacingAfterPt { get; set; } = 120;       // twips after each paragraph
    public string HeadingFontFamily { get; set; } = "Calibri";
    public Dictionary<int, (string Font, int SizePt)> HeadingFonts { get; set; } = new();
    public Dictionary<int, int> HeadingSpacingBefore { get; set; } = new();
    public Dictionary<int, int> HeadingSpacingAfter { get; set; } = new();
    public int Columns { get; set; } = 1;
    public double PageWidth { get; set; } = 8.5;
    public double PageHeight { get; set; } = 11.0;
    public double MarginTop { get; set; } = 1.0;
    public double MarginBottom { get; set; } = 1.0;
    public double MarginLeft { get; set; } = 1.0;
    public double MarginRight { get; set; } = 1.0;
    public bool Justify { get; set; } = true;
}
