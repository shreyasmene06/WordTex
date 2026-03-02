//! OMML to MathML converter.

const MATHML_NS: &str = "http://www.w3.org/1998/Math/MathML";

pub fn omml_to_mathml(omml: &str) -> String {
    match roxmltree::Document::parse(omml) {
        Ok(doc) => {
            let root = doc.root_element();
            let content = convert_omml_element(&root);
            format!("<math xmlns=\"{}\">{}</math>", MATHML_NS, content)
        }
        Err(_) => {
            format!("<math xmlns=\"{}\"><merror><mtext>parse error</mtext></merror></math>", MATHML_NS)
        }
    }
}

fn convert_omml_element(node: &roxmltree::Node) -> String {
    let tag = node.tag_name().name();

    match tag {
        "oMathPara" | "oMath" => {
            node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_omml_element(&c))
                .collect::<Vec<_>>()
                .join("")
        }

        "r" => {
            // Run element
            let text = find_text(node);
            let props = node.children().find(|c| c.tag_name().name() == "rPr");

            if let Some(rpr) = props {
                if rpr.children().any(|c| c.tag_name().name() == "nor") {
                    return format!("<mtext>{}</mtext>", escape(&text));
                }
                if let Some(sty) = rpr.children().find(|c| c.tag_name().name() == "sty") {
                    let val = sty.attribute(("http://schemas.openxmlformats.org/officeDocument/2006/math", "val"))
                        .or_else(|| sty.attribute("val"))
                        .unwrap_or("p");
                    return match val {
                        "b" => format!("<mi mathvariant=\"bold\">{}</mi>", escape(&text)),
                        "bi" => format!("<mi mathvariant=\"bold-italic\">{}</mi>", escape(&text)),
                        "i" => format!("<mi>{}</mi>", escape(&text)),
                        "p" => format!("<mi mathvariant=\"normal\">{}</mi>", escape(&text)),
                        _ => format!("<mi>{}</mi>", escape(&text)),
                    };
                }
                if let Some(scr) = rpr.children().find(|c| c.tag_name().name() == "scr") {
                    let val = scr.attribute(("http://schemas.openxmlformats.org/officeDocument/2006/math", "val"))
                        .or_else(|| scr.attribute("val"))
                        .unwrap_or("");
                    return format!("<mi mathvariant=\"{}\">{}</mi>", val, escape(&text));
                }
            }

            // Determine mi/mn/mo
            if text.chars().all(|c| c.is_ascii_digit() || c == '.') {
                format!("<mn>{}</mn>", escape(&text))
            } else if text.len() == 1 && text.chars().next().map_or(false, |c| c.is_alphabetic()) {
                format!("<mi>{}</mi>", escape(&text))
            } else {
                format!("<mo>{}</mo>", escape(&text))
            }
        }

        "f" => {
            // Fraction
            let num = node.children().find(|c| c.tag_name().name() == "num")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            let den = node.children().find(|c| c.tag_name().name() == "den")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            format!("<mfrac><mrow>{}</mrow><mrow>{}</mrow></mfrac>", num, den)
        }

        "rad" => {
            // Radical
            let deg_hide = node.children()
                .find(|c| c.tag_name().name() == "radPr")
                .and_then(|pr| pr.children().find(|c| c.tag_name().name() == "degHide"))
                .and_then(|dh| dh.attribute(("http://schemas.openxmlformats.org/officeDocument/2006/math", "val"))
                    .or_else(|| dh.attribute("val")))
                .unwrap_or("0");

            let e = node.children().find(|c| c.tag_name().name() == "e")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();

            if deg_hide == "1" {
                format!("<msqrt>{}</msqrt>", e)
            } else {
                let deg = node.children().find(|c| c.tag_name().name() == "deg")
                    .map(|n| convert_omml_element(&n)).unwrap_or_default();
                format!("<mroot>{}{}</mroot>", e, deg)
            }
        }

        "sSup" => {
            let base = node.children().find(|c| c.tag_name().name() == "e")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            let sup = node.children().find(|c| c.tag_name().name() == "sup")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            format!("<msup><mrow>{}</mrow><mrow>{}</mrow></msup>", base, sup)
        }

        "sSub" => {
            let base = node.children().find(|c| c.tag_name().name() == "e")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            let sub = node.children().find(|c| c.tag_name().name() == "sub")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            format!("<msub><mrow>{}</mrow><mrow>{}</mrow></msub>", base, sub)
        }

        "sSubSup" => {
            let base = node.children().find(|c| c.tag_name().name() == "e")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            let sub = node.children().find(|c| c.tag_name().name() == "sub")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            let sup = node.children().find(|c| c.tag_name().name() == "sup")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            format!("<msubsup><mrow>{}</mrow><mrow>{}</mrow><mrow>{}</mrow></msubsup>", base, sub, sup)
        }

        "nary" => {
            let chr = node.children()
                .find(|c| c.tag_name().name() == "naryPr")
                .and_then(|pr| pr.children().find(|c| c.tag_name().name() == "chr"))
                .and_then(|c| c.attribute(("http://schemas.openxmlformats.org/officeDocument/2006/math", "val"))
                    .or_else(|| c.attribute("val")))
                .unwrap_or("∑");

            let sub = node.children().find(|c| c.tag_name().name() == "sub")
                .map(|n| convert_omml_element(&n));
            let sup = node.children().find(|c| c.tag_name().name() == "sup")
                .map(|n| convert_omml_element(&n));
            let e = node.children().find(|c| c.tag_name().name() == "e")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();

            match (sub, sup) {
                (Some(s), Some(p)) => format!("<munderover><mo>{}</mo><mrow>{}</mrow><mrow>{}</mrow></munderover>{}", chr, s, p, e),
                (Some(s), None) => format!("<munder><mo>{}</mo><mrow>{}</mrow></munder>{}", chr, s, e),
                (None, Some(p)) => format!("<mover><mo>{}</mo><mrow>{}</mrow></mover>{}", chr, p, e),
                (None, None) => format!("<mo>{}</mo>{}", chr, e),
            }
        }

        "acc" => {
            let chr = node.children()
                .find(|c| c.tag_name().name() == "accPr")
                .and_then(|pr| pr.children().find(|c| c.tag_name().name() == "chr"))
                .and_then(|c| c.attribute(("http://schemas.openxmlformats.org/officeDocument/2006/math", "val"))
                    .or_else(|| c.attribute("val")))
                .unwrap_or("^");

            let e = node.children().find(|c| c.tag_name().name() == "e")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            format!("<mover accent=\"true\"><mrow>{}</mrow><mo>{}</mo></mover>", e, chr)
        }

        "d" => {
            // Delimiter
            let open = node.children()
                .find(|c| c.tag_name().name() == "dPr")
                .and_then(|pr| pr.children().find(|c| c.tag_name().name() == "begChr"))
                .and_then(|c| c.attribute(("http://schemas.openxmlformats.org/officeDocument/2006/math", "val"))
                    .or_else(|| c.attribute("val")))
                .unwrap_or("(");
            let close = node.children()
                .find(|c| c.tag_name().name() == "dPr")
                .and_then(|pr| pr.children().find(|c| c.tag_name().name() == "endChr"))
                .and_then(|c| c.attribute(("http://schemas.openxmlformats.org/officeDocument/2006/math", "val"))
                    .or_else(|| c.attribute("val")))
                .unwrap_or(")");

            let content = node.children()
                .filter(|c| c.tag_name().name() == "e")
                .map(|c| convert_omml_element(&c))
                .collect::<Vec<_>>()
                .join("<mo>,</mo>");
            format!("<mrow><mo>{}</mo>{}<mo>{}</mo></mrow>", escape(open), content, escape(close))
        }

        "m" => {
            // Matrix
            let mut rows = String::new();
            for mr in node.children().filter(|c| c.tag_name().name() == "mr") {
                rows.push_str("<mtr>");
                for e in mr.children().filter(|c| c.tag_name().name() == "e") {
                    rows.push_str(&format!("<mtd>{}</mtd>", convert_omml_element(&e)));
                }
                rows.push_str("</mtr>");
            }
            format!("<mtable>{}</mtable>", rows)
        }

        "limLow" => {
            let base = node.children().find(|c| c.tag_name().name() == "e")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            let lim = node.children().find(|c| c.tag_name().name() == "lim")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            format!("<munder><mrow>{}</mrow><mrow>{}</mrow></munder>", base, lim)
        }

        "limUpp" => {
            let base = node.children().find(|c| c.tag_name().name() == "e")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            let lim = node.children().find(|c| c.tag_name().name() == "lim")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            format!("<mover><mrow>{}</mrow><mrow>{}</mrow></mover>", base, lim)
        }

        "borderBox" => {
            let e = node.children().find(|c| c.tag_name().name() == "e")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            format!("<menclose notation=\"box\">{}</menclose>", e)
        }

        "phant" => {
            let e = node.children().find(|c| c.tag_name().name() == "e")
                .map(|n| convert_omml_element(&n)).unwrap_or_default();
            format!("<mphantom>{}</mphantom>", e)
        }

        "num" | "den" | "e" | "sub" | "sup" | "lim" | "deg" => {
            node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_omml_element(&c))
                .collect::<Vec<_>>()
                .join("")
        }

        _ => {
            node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_omml_element(&c))
                .collect::<Vec<_>>()
                .join("")
        }
    }
}

fn find_text(node: &roxmltree::Node) -> String {
    for child in node.children() {
        if child.tag_name().name() == "t" {
            return child.text().unwrap_or("").to_string();
        }
        if child.is_element() {
            let result = find_text(&child);
            if !result.is_empty() {
                return result;
            }
        }
    }
    String::new()
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
