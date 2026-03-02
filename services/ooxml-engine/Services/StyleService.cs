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
            HeadingFonts = new() { [1] = ("Helvetica", 24), [2] = ("Helvetica", 18), [3] = ("Helvetica", 14) },
            Columns = 2,
            PageWidth = 8.5,
            PageHeight = 11.0,
            MarginTop = 0.75,
            MarginBottom = 1.0,
            MarginLeft = 0.625,
            MarginRight = 0.625,
        },
        ["acmart"] = new TemplateStyleMap
        {
            BodyFontFamily = "Linux Libertine",
            BodyFontSizePt = 10,
            HeadingFonts = new() { [1] = ("Linux Libertine", 17), [2] = ("Linux Libertine", 12), [3] = ("Linux Libertine", 10) },
            Columns = 2,
            PageWidth = 8.5,
            PageHeight = 11.0,
            MarginTop = 1.18,
            MarginBottom = 0.83,
            MarginLeft = 0.81,
            MarginRight = 0.81,
        },
        ["elsarticle"] = new TemplateStyleMap
        {
            BodyFontFamily = "Times New Roman",
            BodyFontSizePt = 12,
            HeadingFonts = new() { [1] = ("Helvetica", 17), [2] = ("Helvetica", 11), [3] = ("Helvetica", 10) },
            Columns = 1,
            PageWidth = 8.27, // A4
            PageHeight = 11.69,
            MarginTop = 1.0,
            MarginBottom = 1.0,
            MarginLeft = 1.0,
            MarginRight = 1.0,
        },
        ["article"] = new TemplateStyleMap
        {
            BodyFontFamily = "Computer Modern",
            BodyFontSizePt = 10,
            HeadingFonts = new() { [1] = ("Computer Modern", 17), [2] = ("Computer Modern", 14), [3] = ("Computer Modern", 12) },
            Columns = 1,
            PageWidth = 8.5,
            PageHeight = 11.0,
            MarginTop = 1.0,
            MarginBottom = 1.0,
            MarginLeft = 1.0,
            MarginRight = 1.0,
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

        // Normal style (body text)
        var normalStyle = new Style(
            new StyleName { Val = "Normal" },
            new StyleRunProperties(
                new RunFonts { Ascii = template.BodyFontFamily, HighAnsi = template.BodyFontFamily },
                new FontSize { Val = (template.BodyFontSizePt * 2).ToString() }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "Normal",
            Default = true
        };
        styles.AppendChild(normalStyle);

        // Heading styles
        foreach (var (level, (font, size)) in template.HeadingFonts)
        {
            var headingStyle = new Style(
                new StyleName { Val = $"heading {level}" },
                new StyleRunProperties(
                    new Bold(),
                    new RunFonts { Ascii = font, HighAnsi = font },
                    new FontSize { Val = (size * 2).ToString() }
                ),
                new StyleParagraphProperties(
                    new SpacingBetweenLines { Before = "240", After = "120" },
                    new KeepNext()
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
            new StyleParagraphProperties(
                new Indentation { Left = "720", Right = "720" }
            ),
            new StyleRunProperties(
                new FontSize { Val = ((template.BodyFontSizePt - 1) * 2).ToString() }
            )
        )
        {
            Type = StyleValues.Paragraph,
            StyleId = "Abstract"
        });

        // Caption style
        styles.AppendChild(new Style(
            new StyleName { Val = "caption" },
            new StyleRunProperties(
                new FontSize { Val = ((template.BodyFontSizePt - 2) * 2).ToString() }
            ),
            new StyleParagraphProperties(
                new Justification { Val = JustificationValues.Center },
                new SpacingBetweenLines { Before = "120", After = "120" }
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
    public string BodyFontFamily { get; set; } = "Times New Roman";
    public int BodyFontSizePt { get; set; } = 12;
    public Dictionary<int, (string Font, int SizePt)> HeadingFonts { get; set; } = new();
    public int Columns { get; set; } = 1;
    public double PageWidth { get; set; } = 8.5;
    public double PageHeight { get; set; } = 11.0;
    public double MarginTop { get; set; } = 1.0;
    public double MarginBottom { get; set; } = 1.0;
    public double MarginLeft { get; set; } = 1.0;
    public double MarginRight { get; set; } = 1.0;
}
