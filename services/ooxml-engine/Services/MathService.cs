using System.Xml.Linq;

namespace WordTex.OoxmlEngine.Services;

/// <summary>
/// Handles OMML (Office Math Markup Language) generation and parsing.
/// Converts between MathML and OMML for bidirectional math support.
/// </summary>
public class MathService
{
    private readonly ILogger<MathService> _logger;

    // OMML namespace
    private static readonly XNamespace OmmlNs = "http://schemas.openxmlformats.org/officeDocument/2006/math";
    // MathML namespace
    private static readonly XNamespace MathmlNs = "http://www.w3.org/1998/Math/MathML";

    public MathService(ILogger<MathService> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Convert MathML to OMML.
    /// </summary>
    public string MathMLToOMML(string mathml)
    {
        try
        {
            var doc = XDocument.Parse(mathml);
            var root = doc.Root;

            if (root == null) return WrapInOMathPara("<m:r><m:t>[error]</m:t></m:r>");

            var omml = ConvertMathMLElement(root);
            return WrapInOMathPara(omml);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to convert MathML to OMML");
            return WrapInOMathPara("<m:r><m:t>[math conversion error]</m:t></m:r>");
        }
    }

    /// <summary>
    /// Convert OMML to MathML.
    /// </summary>
    public string OMMLToMathML(string omml)
    {
        try
        {
            var doc = XDocument.Parse(omml);
            var root = doc.Root;

            if (root == null) return "<math xmlns=\"http://www.w3.org/1998/Math/MathML\"></math>";

            var mathml = ConvertOMMLElement(root);
            return $"<math xmlns=\"http://www.w3.org/1998/Math/MathML\">{mathml}</math>";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to convert OMML to MathML");
            return "<math xmlns=\"http://www.w3.org/1998/Math/MathML\"><merror><mtext>conversion error</mtext></merror></math>";
        }
    }

    /// <summary>
    /// Build OMML from LaTeX math source (simplified direct conversion).
    /// </summary>
    public string LatexToOMML(string latex)
    {
        // This handles common LaTeX math constructs directly
        var omml = new System.Text.StringBuilder();

        int i = 0;
        while (i < latex.Length)
        {
            if (latex[i] == '\\')
            {
                var cmd = ExtractCommand(latex, ref i);
                omml.Append(ConvertLatexCommand(cmd, latex, ref i));
            }
            else if (latex[i] == '^')
            {
                i++;
                var sup = ExtractGroup(latex, ref i);
                omml.Append($"<m:sSup><m:sSupPr/><m:e><m:r><m:t> </m:t></m:r></m:e><m:sup><m:r><m:t>{EscapeXml(sup)}</m:t></m:r></m:sup></m:sSup>");
            }
            else if (latex[i] == '_')
            {
                i++;
                var sub = ExtractGroup(latex, ref i);
                omml.Append($"<m:sSub><m:sSubPr/><m:e><m:r><m:t> </m:t></m:r></m:e><m:sub><m:r><m:t>{EscapeXml(sub)}</m:t></m:r></m:sub></m:sSub>");
            }
            else if (latex[i] == '{' || latex[i] == '}')
            {
                i++;
            }
            else
            {
                omml.Append($"<m:r><m:t>{EscapeXml(latex[i].ToString())}</m:t></m:r>");
                i++;
            }
        }

        return WrapInOMathPara(omml.ToString());
    }

    private string ConvertLatexCommand(string cmd, string latex, ref int pos)
    {
        return cmd switch
        {
            "frac" => ConvertFraction(latex, ref pos),
            "sqrt" => ConvertSqrt(latex, ref pos),
            "sum" => "<m:nary><m:naryPr><m:chr m:val=\"∑\"/></m:naryPr><m:sub/><m:sup/><m:e/></m:nary>",
            "int" => "<m:nary><m:naryPr><m:chr m:val=\"∫\"/></m:naryPr><m:sub/><m:sup/><m:e/></m:nary>",
            "prod" => "<m:nary><m:naryPr><m:chr m:val=\"∏\"/></m:naryPr><m:sub/><m:sup/><m:e/></m:nary>",
            "alpha" => "<m:r><m:t>α</m:t></m:r>",
            "beta" => "<m:r><m:t>β</m:t></m:r>",
            "gamma" => "<m:r><m:t>γ</m:t></m:r>",
            "delta" => "<m:r><m:t>δ</m:t></m:r>",
            "epsilon" => "<m:r><m:t>ε</m:t></m:r>",
            "theta" => "<m:r><m:t>θ</m:t></m:r>",
            "lambda" => "<m:r><m:t>λ</m:t></m:r>",
            "mu" => "<m:r><m:t>μ</m:t></m:r>",
            "pi" => "<m:r><m:t>π</m:t></m:r>",
            "sigma" => "<m:r><m:t>σ</m:t></m:r>",
            "omega" => "<m:r><m:t>ω</m:t></m:r>",
            "infty" => "<m:r><m:t>∞</m:t></m:r>",
            "partial" => "<m:r><m:t>∂</m:t></m:r>",
            "nabla" => "<m:r><m:t>∇</m:t></m:r>",
            "cdot" => "<m:r><m:t>·</m:t></m:r>",
            "times" => "<m:r><m:t>×</m:t></m:r>",
            "leq" => "<m:r><m:t>≤</m:t></m:r>",
            "geq" => "<m:r><m:t>≥</m:t></m:r>",
            "neq" => "<m:r><m:t>≠</m:t></m:r>",
            "approx" => "<m:r><m:t>≈</m:t></m:r>",
            "in" => "<m:r><m:t>∈</m:t></m:r>",
            "forall" => "<m:r><m:t>∀</m:t></m:r>",
            "exists" => "<m:r><m:t>∃</m:t></m:r>",
            "rightarrow" => "<m:r><m:t>→</m:t></m:r>",
            "leftarrow" => "<m:r><m:t>←</m:t></m:r>",
            "Rightarrow" => "<m:r><m:t>⇒</m:t></m:r>",
            "Leftarrow" => "<m:r><m:t>⇐</m:t></m:r>",
            "mathbb" => ConvertMathbb(latex, ref pos),
            "mathcal" => ConvertMathcal(latex, ref pos),
            "text" or "mathrm" => ConvertMathText(latex, ref pos),
            "left" or "right" => "<m:r><m:t></m:t></m:r>", // Delimiters handled separately
            _ => $"<m:r><m:t>\\{cmd}</m:t></m:r>",
        };
    }

    private string ConvertFraction(string latex, ref int pos)
    {
        var num = ExtractGroup(latex, ref pos);
        var den = ExtractGroup(latex, ref pos);
        return $"<m:f><m:fPr><m:type m:val=\"bar\"/></m:fPr><m:num><m:r><m:t>{EscapeXml(num)}</m:t></m:r></m:num><m:den><m:r><m:t>{EscapeXml(den)}</m:t></m:r></m:den></m:f>";
    }

    private string ConvertSqrt(string latex, ref int pos)
    {
        var content = ExtractGroup(latex, ref pos);
        return $"<m:rad><m:radPr><m:degHide m:val=\"1\"/></m:radPr><m:deg/><m:e><m:r><m:t>{EscapeXml(content)}</m:t></m:r></m:e></m:rad>";
    }

    private string ConvertMathbb(string latex, ref int pos)
    {
        var content = ExtractGroup(latex, ref pos);
        // Map common blackboard bold letters
        var mapped = content switch
        {
            "R" => "ℝ",
            "N" => "ℕ",
            "Z" => "ℤ",
            "Q" => "ℚ",
            "C" => "ℂ",
            "F" => "𝔽",
            "E" => "𝔼",
            "P" => "ℙ",
            _ => content,
        };
        return $"<m:r><m:rPr><m:scr m:val=\"double-struck\"/></m:rPr><m:t>{mapped}</m:t></m:r>";
    }

    private string ConvertMathcal(string latex, ref int pos)
    {
        var content = ExtractGroup(latex, ref pos);
        return $"<m:r><m:rPr><m:scr m:val=\"script\"/></m:rPr><m:t>{EscapeXml(content)}</m:t></m:r>";
    }

    private string ConvertMathText(string latex, ref int pos)
    {
        var content = ExtractGroup(latex, ref pos);
        return $"<m:r><m:rPr><m:nor/></m:rPr><m:t>{EscapeXml(content)}</m:t></m:r>";
    }

    private string ConvertMathMLElement(XElement element)
    {
        var localName = element.Name.LocalName;
        return localName switch
        {
            "math" => string.Join("", element.Elements().Select(ConvertMathMLElement)),
            "mrow" => string.Join("", element.Elements().Select(ConvertMathMLElement)),
            "mi" => $"<m:r><m:rPr><m:sty m:val=\"i\"/></m:rPr><m:t>{EscapeXml(element.Value)}</m:t></m:r>",
            "mn" => $"<m:r><m:t>{EscapeXml(element.Value)}</m:t></m:r>",
            "mo" => $"<m:r><m:t>{EscapeXml(element.Value)}</m:t></m:r>",
            "mtext" => $"<m:r><m:rPr><m:nor/></m:rPr><m:t>{EscapeXml(element.Value)}</m:t></m:r>",
            "mfrac" => ConvertMathMLFraction(element),
            "msqrt" => ConvertMathMLSqrt(element),
            "msup" => ConvertMathMLSup(element),
            "msub" => ConvertMathMLSub(element),
            "msubsup" => ConvertMathMLSubSup(element),
            "mover" => ConvertMathMLOver(element),
            "munder" => ConvertMathMLUnder(element),
            "mtable" => ConvertMathMLMatrix(element),
            _ => $"<m:r><m:t>{EscapeXml(element.Value)}</m:t></m:r>",
        };
    }

    private string ConvertMathMLFraction(XElement element)
    {
        var children = element.Elements().ToList();
        var num = children.Count > 0 ? ConvertMathMLElement(children[0]) : "";
        var den = children.Count > 1 ? ConvertMathMLElement(children[1]) : "";
        return $"<m:f><m:fPr><m:type m:val=\"bar\"/></m:fPr><m:num>{num}</m:num><m:den>{den}</m:den></m:f>";
    }

    private string ConvertMathMLSqrt(XElement element)
    {
        var content = string.Join("", element.Elements().Select(ConvertMathMLElement));
        return $"<m:rad><m:radPr><m:degHide m:val=\"1\"/></m:radPr><m:deg/><m:e>{content}</m:e></m:rad>";
    }

    private string ConvertMathMLSup(XElement element)
    {
        var children = element.Elements().ToList();
        var @base = children.Count > 0 ? ConvertMathMLElement(children[0]) : "";
        var sup = children.Count > 1 ? ConvertMathMLElement(children[1]) : "";
        return $"<m:sSup><m:sSupPr/><m:e>{@base}</m:e><m:sup>{sup}</m:sup></m:sSup>";
    }

    private string ConvertMathMLSub(XElement element)
    {
        var children = element.Elements().ToList();
        var @base = children.Count > 0 ? ConvertMathMLElement(children[0]) : "";
        var sub = children.Count > 1 ? ConvertMathMLElement(children[1]) : "";
        return $"<m:sSub><m:sSubPr/><m:e>{@base}</m:e><m:sub>{sub}</m:sub></m:sSub>";
    }

    private string ConvertMathMLSubSup(XElement element)
    {
        var children = element.Elements().ToList();
        var @base = children.Count > 0 ? ConvertMathMLElement(children[0]) : "";
        var sub = children.Count > 1 ? ConvertMathMLElement(children[1]) : "";
        var sup = children.Count > 2 ? ConvertMathMLElement(children[2]) : "";
        return $"<m:sSubSup><m:sSubSupPr/><m:e>{@base}</m:e><m:sub>{sub}</m:sub><m:sup>{sup}</m:sup></m:sSubSup>";
    }

    private string ConvertMathMLOver(XElement element)
    {
        var children = element.Elements().ToList();
        var @base = children.Count > 0 ? ConvertMathMLElement(children[0]) : "";
        var acc = children.Count > 1 ? ConvertMathMLElement(children[1]) : "";
        return $"<m:acc><m:accPr/><m:e>{@base}</m:e></m:acc>";
    }

    private string ConvertMathMLUnder(XElement element)
    {
        var children = element.Elements().ToList();
        var @base = children.Count > 0 ? ConvertMathMLElement(children[0]) : "";
        return $"<m:groupChr><m:groupChrPr/><m:e>{@base}</m:e></m:groupChr>";
    }

    private string ConvertMathMLMatrix(XElement element)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append("<m:m><m:mPr/>");

        foreach (var row in element.Elements().Where(e => e.Name.LocalName == "mtr"))
        {
            sb.Append("<m:mr>");
            foreach (var cell in row.Elements().Where(e => e.Name.LocalName == "mtd"))
            {
                sb.Append("<m:e>");
                sb.Append(string.Join("", cell.Elements().Select(ConvertMathMLElement)));
                sb.Append("</m:e>");
            }
            sb.Append("</m:mr>");
        }

        sb.Append("</m:m>");
        return sb.ToString();
    }

    private string ConvertOMMLElement(XElement element)
    {
        var localName = element.Name.LocalName;
        return localName switch
        {
            "oMath" or "oMathPara" => $"<mrow>{string.Join("", element.Elements().Select(ConvertOMMLElement))}</mrow>",
            "r" => ConvertOMMLRun(element),
            "f" => ConvertOMMLFraction(element),
            "rad" => ConvertOMMLRadical(element),
            "sSup" => ConvertOMMLSup(element),
            "sSub" => ConvertOMMLSub(element),
            "sSubSup" => ConvertOMMLSubSup(element),
            "nary" => ConvertOMMLNary(element),
            "m" => ConvertOMMLMatrix(element),
            "d" => ConvertOMMLDelimiter(element),
            _ => string.Join("", element.Elements().Select(ConvertOMMLElement)),
        };
    }

    private string ConvertOMMLRun(XElement element)
    {
        var text = element.Descendants().FirstOrDefault(e => e.Name.LocalName == "t")?.Value ?? "";
        var props = element.Element(OmmlNs + "rPr");
        var isNormal = props?.Element(OmmlNs + "nor") != null;
        return isNormal
            ? $"<mtext>{EscapeXml(text)}</mtext>"
            : $"<mi>{EscapeXml(text)}</mi>";
    }

    private string ConvertOMMLFraction(XElement element)
    {
        var num = element.Element(OmmlNs + "num");
        var den = element.Element(OmmlNs + "den");
        return $"<mfrac>{(num != null ? ConvertOMMLElement(num) : "")}{(den != null ? ConvertOMMLElement(den) : "")}</mfrac>";
    }

    private string ConvertOMMLRadical(XElement element)
    {
        var e = element.Element(OmmlNs + "e");
        return $"<msqrt>{(e != null ? ConvertOMMLElement(e) : "")}</msqrt>";
    }

    private string ConvertOMMLSup(XElement element)
    {
        var e = element.Element(OmmlNs + "e");
        var sup = element.Element(OmmlNs + "sup");
        return $"<msup>{(e != null ? ConvertOMMLElement(e) : "")}{(sup != null ? ConvertOMMLElement(sup) : "")}</msup>";
    }

    private string ConvertOMMLSub(XElement element)
    {
        var e = element.Element(OmmlNs + "e");
        var sub = element.Element(OmmlNs + "sub");
        return $"<msub>{(e != null ? ConvertOMMLElement(e) : "")}{(sub != null ? ConvertOMMLElement(sub) : "")}</msub>";
    }

    private string ConvertOMMLSubSup(XElement element)
    {
        var e = element.Element(OmmlNs + "e");
        var sub = element.Element(OmmlNs + "sub");
        var sup = element.Element(OmmlNs + "sup");
        return $"<msubsup>{(e != null ? ConvertOMMLElement(e) : "")}{(sub != null ? ConvertOMMLElement(sub) : "")}{(sup != null ? ConvertOMMLElement(sup) : "")}</msubsup>";
    }

    private string ConvertOMMLNary(XElement element)
    {
        var chr = element.Descendants().FirstOrDefault(e => e.Name.LocalName == "chr")?.Attribute(OmmlNs + "val")?.Value ?? "∑";
        return $"<mo>{chr}</mo>";
    }

    private string ConvertOMMLMatrix(XElement element)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append("<mtable>");
        foreach (var row in element.Elements().Where(e => e.Name.LocalName == "mr"))
        {
            sb.Append("<mtr>");
            foreach (var cell in row.Elements().Where(e => e.Name.LocalName == "e"))
            {
                sb.Append("<mtd>");
                sb.Append(ConvertOMMLElement(cell));
                sb.Append("</mtd>");
            }
            sb.Append("</mtr>");
        }
        sb.Append("</mtable>");
        return sb.ToString();
    }

    private string ConvertOMMLDelimiter(XElement element)
    {
        var content = string.Join("", element.Elements().Where(e => e.Name.LocalName == "e").Select(ConvertOMMLElement));
        return $"<mfenced>{content}</mfenced>";
    }

    private static string WrapInOMathPara(string content)
    {
        return $"<m:oMathPara xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\"><m:oMath>{content}</m:oMath></m:oMathPara>";
    }

    private static string ExtractCommand(string latex, ref int pos)
    {
        pos++; // skip backslash
        int start = pos;
        while (pos < latex.Length && char.IsLetter(latex[pos]))
            pos++;
        return latex[start..pos];
    }

    private static string ExtractGroup(string latex, ref int pos)
    {
        while (pos < latex.Length && latex[pos] == ' ')
            pos++;

        if (pos >= latex.Length) return "";

        if (latex[pos] == '{')
        {
            pos++;
            int depth = 1;
            int start = pos;
            while (pos < latex.Length && depth > 0)
            {
                if (latex[pos] == '{') depth++;
                else if (latex[pos] == '}') depth--;
                if (depth > 0) pos++;
            }
            var result = latex[start..pos];
            if (pos < latex.Length) pos++; // skip closing brace
            return result;
        }
        else
        {
            var result = latex[pos].ToString();
            pos++;
            return result;
        }
    }

    private static string EscapeXml(string text)
    {
        return text
            .Replace("&", "&amp;")
            .Replace("<", "&lt;")
            .Replace(">", "&gt;")
            .Replace("\"", "&quot;");
    }
}
