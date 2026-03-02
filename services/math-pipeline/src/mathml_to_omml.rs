//! MathML to OMML (Office Math Markup Language) converter.
//!
//! Implements the conversion from W3C MathML to Microsoft OMML
//! following the ECMA-376 spec for equation representation in .docx files.

const OMML_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/math";

pub fn mathml_to_omml(mathml: &str) -> String {
    match roxmltree::Document::parse(mathml) {
        Ok(doc) => {
            let root = doc.root_element();
            let content = convert_element(&root);
            format!("<m:oMathPara xmlns:m=\"{}\"><m:oMath>{}</m:oMath></m:oMathPara>", OMML_NS, content)
        }
        Err(_) => {
            format!("<m:oMathPara xmlns:m=\"{}\"><m:oMath><m:r><m:t>[parse error]</m:t></m:r></m:oMath></m:oMathPara>", OMML_NS)
        }
    }
}

fn convert_element(node: &roxmltree::Node) -> String {
    let tag = node.tag_name().name();

    match tag {
        "math" | "mrow" => {
            node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_element(&c))
                .collect::<Vec<_>>()
                .join("")
        }

        "mi" => {
            let text = node.text().unwrap_or("");
            let variant = node.attribute("mathvariant").unwrap_or("italic");
            match variant {
                "normal" => format!("<m:r><m:rPr><m:sty m:val=\"p\"/></m:rPr><m:t>{}</m:t></m:r>", escape(text)),
                "bold" => format!("<m:r><m:rPr><m:sty m:val=\"b\"/></m:rPr><m:t>{}</m:t></m:r>", escape(text)),
                "bold-italic" => format!("<m:r><m:rPr><m:sty m:val=\"bi\"/></m:rPr><m:t>{}</m:t></m:r>", escape(text)),
                "double-struck" => format!("<m:r><m:rPr><m:scr m:val=\"double-struck\"/></m:rPr><m:t>{}</m:t></m:r>", escape(text)),
                "script" => format!("<m:r><m:rPr><m:scr m:val=\"script\"/></m:rPr><m:t>{}</m:t></m:r>", escape(text)),
                "fraktur" => format!("<m:r><m:rPr><m:scr m:val=\"fraktur\"/></m:rPr><m:t>{}</m:t></m:r>", escape(text)),
                "sans-serif" => format!("<m:r><m:rPr><m:scr m:val=\"sans-serif\"/></m:rPr><m:t>{}</m:t></m:r>", escape(text)),
                "monospace" => format!("<m:r><m:rPr><m:scr m:val=\"monospace\"/></m:rPr><m:t>{}</m:t></m:r>", escape(text)),
                _ => format!("<m:r><m:rPr><m:sty m:val=\"i\"/></m:rPr><m:t>{}</m:t></m:r>", escape(text)),
            }
        }

        "mn" => {
            let text = node.text().unwrap_or("0");
            format!("<m:r><m:t>{}</m:t></m:r>", escape(text))
        }

        "mo" => {
            let text = node.text().unwrap_or("");
            // Check if it's a large operator
            if is_large_operator(text) {
                format!("<m:r><m:t>{}</m:t></m:r>", escape(text))
            } else {
                format!("<m:r><m:t>{}</m:t></m:r>", escape(text))
            }
        }

        "mtext" => {
            let text = node.text().unwrap_or("");
            format!("<m:r><m:rPr><m:nor/></m:rPr><m:t>{}</m:t></m:r>", escape(text))
        }

        "mfrac" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let num = children.first().map(|c| convert_element(c)).unwrap_or_default();
            let den = children.get(1).map(|c| convert_element(c)).unwrap_or_default();
            format!("<m:f><m:fPr><m:type m:val=\"bar\"/></m:fPr><m:num>{}</m:num><m:den>{}</m:den></m:f>", num, den)
        }

        "msqrt" => {
            let content = node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_element(&c))
                .collect::<Vec<_>>()
                .join("");
            format!("<m:rad><m:radPr><m:degHide m:val=\"1\"/></m:radPr><m:deg/><m:e>{}</m:e></m:rad>", content)
        }

        "mroot" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_element(c)).unwrap_or_default();
            let degree = children.get(1).map(|c| convert_element(c)).unwrap_or_default();
            format!("<m:rad><m:radPr><m:degHide m:val=\"0\"/></m:radPr><m:deg>{}</m:deg><m:e>{}</m:e></m:rad>", degree, base)
        }

        "msup" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_element(c)).unwrap_or_default();
            let sup = children.get(1).map(|c| convert_element(c)).unwrap_or_default();
            format!("<m:sSup><m:sSupPr/><m:e>{}</m:e><m:sup>{}</m:sup></m:sSup>", base, sup)
        }

        "msub" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_element(c)).unwrap_or_default();
            let sub = children.get(1).map(|c| convert_element(c)).unwrap_or_default();
            format!("<m:sSub><m:sSubPr/><m:e>{}</m:e><m:sub>{}</m:sub></m:sSub>", base, sub)
        }

        "msubsup" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_element(c)).unwrap_or_default();
            let sub = children.get(1).map(|c| convert_element(c)).unwrap_or_default();
            let sup = children.get(2).map(|c| convert_element(c)).unwrap_or_default();
            format!("<m:sSubSup><m:sSubSupPr/><m:e>{}</m:e><m:sub>{}</m:sub><m:sup>{}</m:sup></m:sSubSup>", base, sub, sup)
        }

        "mover" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_element(c)).unwrap_or_default();
            let over = children.get(1).map(|c| convert_element(c)).unwrap_or_default();
            // Check for accent
            let is_accent = node.attribute("accent").map_or(false, |v| v == "true");
            if is_accent {
                format!("<m:acc><m:accPr><m:chr m:val=\"{}\"/></m:accPr><m:e>{}</m:e></m:acc>",
                    children.get(1).and_then(|c| c.text()).unwrap_or(""),
                    base)
            } else {
                format!("<m:limUpp><m:limUppPr/><m:e>{}</m:e><m:lim>{}</m:lim></m:limUpp>", base, over)
            }
        }

        "munder" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let _base = children.first().map(|c| convert_element(c)).unwrap_or_default();
            let under = children.get(1).map(|c| convert_element(c)).unwrap_or_default();
            format!("<m:limLow><m:limLowPr/><m:e>{}</m:e><m:lim>{}</m:lim></m:limLow>", _base, under)
        }

        "munderover" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let _base = children.first().map(|c| convert_element(c)).unwrap_or_default();
            let under = children.get(1).map(|c| convert_element(c)).unwrap_or_default();
            let over = children.get(2).map(|c| convert_element(c)).unwrap_or_default();
            format!("<m:nary><m:naryPr><m:chr m:val=\"{}\"/></m:naryPr><m:sub>{}</m:sub><m:sup>{}</m:sup><m:e>{}</m:e></m:nary>",
                children.first().and_then(|c| c.text()).unwrap_or("∑"),
                under, over, "")
        }

        "mtable" => {
            let mut rows = String::new();
            for child in node.children().filter(|c| c.is_element() && c.tag_name().name() == "mtr") {
                rows.push_str("<m:mr>");
                for cell in child.children().filter(|c| c.is_element() && c.tag_name().name() == "mtd") {
                    let content = cell.children()
                        .filter(|c| c.is_element())
                        .map(|c| convert_element(&c))
                        .collect::<Vec<_>>()
                        .join("");
                    rows.push_str(&format!("<m:e>{}</m:e>", content));
                }
                rows.push_str("</m:mr>");
            }
            format!("<m:m><m:mPr/>{}</m:m>", rows)
        }

        "mfenced" => {
            let open = node.attribute("open").unwrap_or("(");
            let close = node.attribute("close").unwrap_or(")");
            let content = node.children()
                .filter(|c| c.is_element())
                .map(|c| format!("<m:e>{}</m:e>", convert_element(&c)))
                .collect::<Vec<_>>()
                .join("");
            format!(
                "<m:d><m:dPr><m:begChr m:val=\"{}\"/><m:endChr m:val=\"{}\"/></m:dPr>{}</m:d>",
                escape(open), escape(close), content
            )
        }

        "mspace" => String::new(),

        "mphantom" => {
            let content = node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_element(&c))
                .collect::<Vec<_>>()
                .join("");
            format!("<m:phant><m:phantPr/><m:e>{}</m:e></m:phant>", content)
        }

        "menclose" => {
            let _notation = node.attribute("notation").unwrap_or("box");
            let content = node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_element(&c))
                .collect::<Vec<_>>()
                .join("");
            // OMML doesn't directly support menclose, render as bordered
            format!("<m:borderBox><m:borderBoxPr/><m:e>{}</m:e></m:borderBox>", content)
        }

        "mstyle" => {
            // Pass through children
            node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_element(&c))
                .collect::<Vec<_>>()
                .join("")
        }

        _ => {
            // Generic handling: recurse into children
            node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_element(&c))
                .collect::<Vec<_>>()
                .join("")
        }
    }
}

fn is_large_operator(text: &str) -> bool {
    matches!(text, "∑" | "∏" | "∐" | "∫" | "∬" | "∭" | "∮" | "⋃" | "⋂" | "⨁" | "⨂" | "⋁" | "⋀")
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_fraction() {
        let mathml = r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>"#;
        let omml = mathml_to_omml(mathml);
        assert!(omml.contains("<m:f>"));
        assert!(omml.contains("<m:num>"));
        assert!(omml.contains("<m:den>"));
    }

    #[test]
    fn test_subscript() {
        let mathml = r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><msub><mi>x</mi><mn>2</mn></msub></math>"#;
        let omml = mathml_to_omml(mathml);
        assert!(omml.contains("<m:sSub>"));
    }
}
