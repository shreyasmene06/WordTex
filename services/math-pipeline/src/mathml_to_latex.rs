//! MathML to LaTeX converter.

pub fn mathml_to_latex(mathml: &str) -> String {
    match roxmltree::Document::parse(mathml) {
        Ok(doc) => {
            let root = doc.root_element();
            convert_to_latex(&root)
        }
        Err(_) => "\\text{[parse error]}".to_string(),
    }
}

fn convert_to_latex(node: &roxmltree::Node) -> String {
    let tag = node.tag_name().name();

    match tag {
        "math" | "mrow" | "mstyle" => {
            node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_to_latex(&c))
                .collect::<Vec<_>>()
                .join("")
        }

        "mi" => {
            let text = node.text().unwrap_or("");
            let variant = node.attribute("mathvariant").unwrap_or("");
            match variant {
                "double-struck" => format!("\\mathbb{{{}}}", text),
                "script" => format!("\\mathcal{{{}}}", text),
                "fraktur" => format!("\\mathfrak{{{}}}", text),
                "bold" => format!("\\mathbf{{{}}}", text),
                "bold-italic" => format!("\\boldsymbol{{{}}}", text),
                "sans-serif" => format!("\\mathsf{{{}}}", text),
                "monospace" => format!("\\mathtt{{{}}}", text),
                "normal" => format!("\\mathrm{{{}}}", text),
                _ => {
                    // Check for Greek letters and symbols
                    unicode_to_latex(text)
                }
            }
        }

        "mn" => node.text().unwrap_or("0").to_string(),

        "mo" => {
            let text = node.text().unwrap_or("");
            unicode_to_latex(text)
        }

        "mtext" => {
            let text = node.text().unwrap_or("");
            format!("\\text{{{}}}", text)
        }

        "mfrac" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let num = children.first().map(|c| convert_to_latex(c)).unwrap_or_default();
            let den = children.get(1).map(|c| convert_to_latex(c)).unwrap_or_default();
            format!("\\frac{{{}}}{{{}}}", num, den)
        }

        "msqrt" => {
            let content = node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_to_latex(&c))
                .collect::<Vec<_>>()
                .join("");
            format!("\\sqrt{{{}}}", content)
        }

        "mroot" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_to_latex(c)).unwrap_or_default();
            let degree = children.get(1).map(|c| convert_to_latex(c)).unwrap_or_default();
            format!("\\sqrt[{}]{{{}}}", degree, base)
        }

        "msup" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_to_latex(c)).unwrap_or_default();
            let sup = children.get(1).map(|c| convert_to_latex(c)).unwrap_or_default();
            format!("{}^{{{}}}", wrap_if_needed(&base), sup)
        }

        "msub" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_to_latex(c)).unwrap_or_default();
            let sub = children.get(1).map(|c| convert_to_latex(c)).unwrap_or_default();
            format!("{}_{{{}}}", wrap_if_needed(&base), sub)
        }

        "msubsup" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_to_latex(c)).unwrap_or_default();
            let sub = children.get(1).map(|c| convert_to_latex(c)).unwrap_or_default();
            let sup = children.get(2).map(|c| convert_to_latex(c)).unwrap_or_default();
            format!("{}_{{{}}}^{{{}}}", wrap_if_needed(&base), sub, sup)
        }

        "mover" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_to_latex(c)).unwrap_or_default();
            let over = children.get(1).map(|c| c.text().unwrap_or("")).unwrap_or("");

            match over {
                "^" | "̂" => format!("\\hat{{{}}}", base),
                "¯" | "̄" => format!("\\bar{{{}}}", base),
                "→" | "⃗" => format!("\\vec{{{}}}", base),
                "˙" | "̇" => format!("\\dot{{{}}}", base),
                "¨" | "̈" => format!("\\ddot{{{}}}", base),
                "~" | "̃" => format!("\\tilde{{{}}}", base),
                "⏞" => format!("\\overbrace{{{}}}", base),
                _ => {
                    let over_latex = children.get(1).map(|c| convert_to_latex(c)).unwrap_or_default();
                    format!("\\overset{{{}}}{{{}}} ", over_latex, base)
                }
            }
        }

        "munder" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_to_latex(c)).unwrap_or_default();
            let under_text = children.get(1).map(|c| c.text().unwrap_or("")).unwrap_or("");

            match under_text {
                "_" => format!("\\underline{{{}}}", base),
                "⏟" => format!("\\underbrace{{{}}}", base),
                _ => {
                    let under_latex = children.get(1).map(|c| convert_to_latex(c)).unwrap_or_default();
                    format!("\\underset{{{}}}{{{}}} ", under_latex, base)
                }
            }
        }

        "munderover" => {
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            let base = children.first().map(|c| convert_to_latex(c)).unwrap_or_default();
            let under = children.get(1).map(|c| convert_to_latex(c)).unwrap_or_default();
            let over = children.get(2).map(|c| convert_to_latex(c)).unwrap_or_default();
            format!("{}_{{{}}}^{{{}}}", base, under, over)
        }

        "mtable" => {
            let mut rows = Vec::new();
            for row in node.children().filter(|c| c.is_element() && c.tag_name().name() == "mtr") {
                let cells: Vec<String> = row.children()
                    .filter(|c| c.is_element() && c.tag_name().name() == "mtd")
                    .map(|cell| {
                        cell.children()
                            .filter(|c| c.is_element())
                            .map(|c| convert_to_latex(&c))
                            .collect::<Vec<_>>()
                            .join("")
                    })
                    .collect();
                rows.push(cells.join(" & "));
            }
            rows.join(" \\\\\n")
        }

        "mfenced" => {
            let open = node.attribute("open").unwrap_or("(");
            let close = node.attribute("close").unwrap_or(")");
            let content = node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_to_latex(&c))
                .collect::<Vec<_>>()
                .join(", ");
            let open_latex = match open {
                "(" => "\\left(",
                "[" => "\\left[",
                "{" => "\\left\\{",
                "|" => "\\left|",
                "⟨" => "\\left\\langle ",
                _ => open,
            };
            let close_latex = match close {
                ")" => "\\right)",
                "]" => "\\right]",
                "}" => "\\right\\}",
                "|" => "\\right|",
                "⟩" => "\\right\\rangle ",
                _ => close,
            };
            format!("{}{}{}", open_latex, content, close_latex)
        }

        "mspace" => {
            let width = node.attribute("width").unwrap_or("");
            match width {
                "1em" => "\\quad ".to_string(),
                "2em" => "\\qquad ".to_string(),
                "0.167em" => "\\, ".to_string(),
                "0.222em" => "\\: ".to_string(),
                "0.278em" => "\\; ".to_string(),
                "-0.167em" => "\\! ".to_string(),
                _ => " ".to_string(),
            }
        }

        "mphantom" => {
            let content = node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_to_latex(&c))
                .collect::<Vec<_>>()
                .join("");
            format!("\\phantom{{{}}}", content)
        }

        "menclose" => {
            let notation = node.attribute("notation").unwrap_or("box");
            let content = node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_to_latex(&c))
                .collect::<Vec<_>>()
                .join("");
            match notation {
                "box" => format!("\\boxed{{{}}}", content),
                "updiagonalstrike" => format!("\\cancel{{{}}}", content),
                _ => content,
            }
        }

        "merror" => {
            let text = node.text().unwrap_or("error");
            format!("\\text{{[{}]}}", text)
        }

        _ => {
            node.children()
                .filter(|c| c.is_element())
                .map(|c| convert_to_latex(&c))
                .collect::<Vec<_>>()
                .join("")
        }
    }
}

fn unicode_to_latex(text: &str) -> String {
    match text {
        "α" => "\\alpha ".to_string(),
        "β" => "\\beta ".to_string(),
        "γ" => "\\gamma ".to_string(),
        "δ" => "\\delta ".to_string(),
        "ε" | "ϵ" => "\\epsilon ".to_string(),
        "ζ" => "\\zeta ".to_string(),
        "η" => "\\eta ".to_string(),
        "θ" | "ϑ" => "\\theta ".to_string(),
        "ι" => "\\iota ".to_string(),
        "κ" => "\\kappa ".to_string(),
        "λ" => "\\lambda ".to_string(),
        "μ" => "\\mu ".to_string(),
        "ν" => "\\nu ".to_string(),
        "ξ" => "\\xi ".to_string(),
        "π" => "\\pi ".to_string(),
        "ρ" => "\\rho ".to_string(),
        "σ" | "ς" => "\\sigma ".to_string(),
        "τ" => "\\tau ".to_string(),
        "υ" => "\\upsilon ".to_string(),
        "φ" | "ϕ" => "\\phi ".to_string(),
        "χ" => "\\chi ".to_string(),
        "ψ" => "\\psi ".to_string(),
        "ω" => "\\omega ".to_string(),
        "Γ" => "\\Gamma ".to_string(),
        "Δ" => "\\Delta ".to_string(),
        "Θ" => "\\Theta ".to_string(),
        "Λ" => "\\Lambda ".to_string(),
        "Ξ" => "\\Xi ".to_string(),
        "Π" => "\\Pi ".to_string(),
        "Σ" => "\\Sigma ".to_string(),
        "Υ" => "\\Upsilon ".to_string(),
        "Φ" => "\\Phi ".to_string(),
        "Ψ" => "\\Psi ".to_string(),
        "Ω" => "\\Omega ".to_string(),
        "∞" => "\\infty ".to_string(),
        "∂" => "\\partial ".to_string(),
        "∇" => "\\nabla ".to_string(),
        "∑" => "\\sum ".to_string(),
        "∏" => "\\prod ".to_string(),
        "∫" => "\\int ".to_string(),
        "∬" => "\\iint ".to_string(),
        "∭" => "\\iiint ".to_string(),
        "∮" => "\\oint ".to_string(),
        "×" => "\\times ".to_string(),
        "÷" => "\\div ".to_string(),
        "±" => "\\pm ".to_string(),
        "∓" => "\\mp ".to_string(),
        "·" => "\\cdot ".to_string(),
        "≤" => "\\leq ".to_string(),
        "≥" => "\\geq ".to_string(),
        "≠" => "\\neq ".to_string(),
        "≈" => "\\approx ".to_string(),
        "≡" => "\\equiv ".to_string(),
        "∈" => "\\in ".to_string(),
        "∉" => "\\notin ".to_string(),
        "⊂" => "\\subset ".to_string(),
        "⊃" => "\\supset ".to_string(),
        "⊆" => "\\subseteq ".to_string(),
        "⊇" => "\\supseteq ".to_string(),
        "∪" => "\\cup ".to_string(),
        "∩" => "\\cap ".to_string(),
        "∀" => "\\forall ".to_string(),
        "∃" => "\\exists ".to_string(),
        "¬" => "\\neg ".to_string(),
        "∧" => "\\wedge ".to_string(),
        "∨" => "\\vee ".to_string(),
        "→" => "\\rightarrow ".to_string(),
        "←" => "\\leftarrow ".to_string(),
        "↔" => "\\leftrightarrow ".to_string(),
        "⇒" => "\\Rightarrow ".to_string(),
        "⇐" => "\\Leftarrow ".to_string(),
        "⇔" => "\\Leftrightarrow ".to_string(),
        "↦" => "\\mapsto ".to_string(),
        "⟨" => "\\langle ".to_string(),
        "⟩" => "\\rangle ".to_string(),
        "⌊" => "\\lfloor ".to_string(),
        "⌋" => "\\rfloor ".to_string(),
        "⌈" => "\\lceil ".to_string(),
        "⌉" => "\\rceil ".to_string(),
        "ℝ" => "\\mathbb{R}".to_string(),
        "ℕ" => "\\mathbb{N}".to_string(),
        "ℤ" => "\\mathbb{Z}".to_string(),
        "ℚ" => "\\mathbb{Q}".to_string(),
        "ℂ" => "\\mathbb{C}".to_string(),
        _ => text.to_string(),
    }
}

fn wrap_if_needed(s: &str) -> String {
    if s.len() > 1 && !s.starts_with('\\') && !s.starts_with('{') {
        format!("{{{}}}", s)
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_fraction() {
        let mathml = r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>"#;
        let latex = mathml_to_latex(mathml);
        assert_eq!(latex, "\\frac{a}{b}");
    }

    #[test]
    fn test_superscript() {
        let mathml = r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup></math>"#;
        let latex = mathml_to_latex(mathml);
        assert_eq!(latex, "x^{2}");
    }

    #[test]
    fn test_greek_letter() {
        let mathml = r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>α</mi></math>"#;
        let latex = mathml_to_latex(mathml);
        assert!(latex.contains("\\alpha"));
    }
}
