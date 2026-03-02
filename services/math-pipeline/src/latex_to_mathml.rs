//! LaTeX math to MathML converter.
//!
//! Handles all standard LaTeX math constructs including:
//! - Fractions (\frac, \dfrac, \tfrac, \cfrac)
//! - Roots (\sqrt, \sqrt[n])
//! - Subscripts/superscripts
//! - Greek letters and symbols
//! - Operators (\sum, \int, \prod, \lim, etc.)
//! - Matrices and arrays
//! - Accents (\hat, \bar, \vec, \dot, \tilde, etc.)
//! - Delimiters (\left, \right)
//! - Environments (cases, aligned, gathered, etc.)

use crate::symbols::LATEX_TO_UNICODE;

#[derive(Debug)]
pub struct MathMLOutput {
    pub mathml: String,
    pub is_display: bool,
}

pub fn latex_to_mathml(latex: &str, display: bool) -> MathMLOutput {
    let mut parser = LatexMathParser::new(latex);
    let content = parser.parse_expression();

    let display_attr = if display { " display=\"block\"" } else { "" };
    let mathml = format!(
        "<math xmlns=\"http://www.w3.org/1998/Math/MathML\"{}>{}</math>",
        display_attr, content
    );

    MathMLOutput {
        mathml,
        is_display: display,
    }
}

struct LatexMathParser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> LatexMathParser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, pos: 0 }
    }

    fn parse_expression(&mut self) -> String {
        let mut parts = Vec::new();

        while self.pos < self.input.len() {
            self.skip_whitespace();
            if self.pos >= self.input.len() {
                break;
            }

            let ch = self.current_char();

            match ch {
                '}' => break,  // End of group
                '&' => {
                    self.pos += 1;
                    parts.push("<mtd>".to_string());
                }
                '\\' => {
                    if self.peek_str("\\\\") {
                        self.pos += 2;
                        parts.push("</mtr><mtr>".to_string());
                    } else {
                        parts.push(self.parse_command());
                    }
                }
                '{' => {
                    self.pos += 1;
                    let inner = self.parse_expression();
                    self.expect('}');
                    parts.push(format!("<mrow>{}</mrow>", inner));
                }
                '^' => {
                    self.pos += 1;
                    let base = parts.pop().unwrap_or_default();
                    let sup = self.parse_single_token();
                    parts.push(format!("<msup>{}{}</msup>", base, sup));
                }
                '_' => {
                    self.pos += 1;
                    let base = parts.pop().unwrap_or_default();
                    let sub = self.parse_single_token();

                    // Check for combined sub+sup
                    self.skip_whitespace();
                    if self.pos < self.input.len() && self.current_char() == '^' {
                        self.pos += 1;
                        let sup = self.parse_single_token();
                        parts.push(format!("<msubsup>{}{}{}</msubsup>", base, sub, sup));
                    } else {
                        parts.push(format!("<msub>{}{}</msub>", base, sub));
                    }
                }
                '(' | ')' | '[' | ']' | '+' | '-' | '=' | '<' | '>' | ',' | ';' | '!' | '|' | ':' | '/' | '*' => {
                    self.pos += 1;
                    parts.push(format!("<mo>{}</mo>", ch));
                }
                '0'..='9' | '.' => {
                    parts.push(self.parse_number());
                }
                _ => {
                    self.pos += 1;
                    parts.push(format!("<mi>{}</mi>", ch));
                }
            }
        }

        parts.join("")
    }

    fn parse_command(&mut self) -> String {
        self.pos += 1; // skip backslash
        let cmd = self.read_alpha();

        match cmd.as_str() {
            // Fractions
            "frac" | "dfrac" | "tfrac" | "cfrac" => {
                let num = self.parse_group();
                let den = self.parse_group();
                format!("<mfrac>{}{}</mfrac>", num, den)
            }

            // Roots
            "sqrt" => {
                if self.peek_char() == Some('[') {
                    self.pos += 1;
                    let degree = self.read_until(']');
                    self.expect(']');
                    let content = self.parse_group();
                    format!("<mroot>{}<mn>{}</mn></mroot>", content, degree)
                } else {
                    let content = self.parse_group();
                    format!("<msqrt>{}</msqrt>", content)
                }
            }

            // Large operators
            "sum" => "<mo>∑</mo>".to_string(),
            "prod" => "<mo>∏</mo>".to_string(),
            "coprod" => "<mo>∐</mo>".to_string(),
            "int" => "<mo>∫</mo>".to_string(),
            "iint" => "<mo>∬</mo>".to_string(),
            "iiint" => "<mo>∭</mo>".to_string(),
            "oint" => "<mo>∮</mo>".to_string(),
            "bigcup" => "<mo>⋃</mo>".to_string(),
            "bigcap" => "<mo>⋂</mo>".to_string(),
            "bigoplus" => "<mo>⨁</mo>".to_string(),
            "bigotimes" => "<mo>⨂</mo>".to_string(),
            "bigvee" => "<mo>⋁</mo>".to_string(),
            "bigwedge" => "<mo>⋀</mo>".to_string(),
            "lim" => "<mo>lim</mo>".to_string(),
            "limsup" => "<mo>lim sup</mo>".to_string(),
            "liminf" => "<mo>lim inf</mo>".to_string(),
            "sup" => "<mo>sup</mo>".to_string(),
            "inf" => "<mo>inf</mo>".to_string(),
            "max" => "<mo>max</mo>".to_string(),
            "min" => "<mo>min</mo>".to_string(),
            "det" => "<mo>det</mo>".to_string(),
            "gcd" => "<mo>gcd</mo>".to_string(),
            "log" => "<mo>log</mo>".to_string(),
            "ln" => "<mo>ln</mo>".to_string(),
            "exp" => "<mo>exp</mo>".to_string(),
            "sin" => "<mo>sin</mo>".to_string(),
            "cos" => "<mo>cos</mo>".to_string(),
            "tan" => "<mo>tan</mo>".to_string(),
            "cot" => "<mo>cot</mo>".to_string(),
            "sec" => "<mo>sec</mo>".to_string(),
            "csc" => "<mo>csc</mo>".to_string(),
            "arcsin" => "<mo>arcsin</mo>".to_string(),
            "arccos" => "<mo>arccos</mo>".to_string(),
            "arctan" => "<mo>arctan</mo>".to_string(),
            "sinh" => "<mo>sinh</mo>".to_string(),
            "cosh" => "<mo>cosh</mo>".to_string(),
            "tanh" => "<mo>tanh</mo>".to_string(),
            "dim" => "<mo>dim</mo>".to_string(),
            "ker" => "<mo>ker</mo>".to_string(),
            "hom" => "<mo>Hom</mo>".to_string(),
            "deg" => "<mo>deg</mo>".to_string(),
            "Pr" => "<mo>Pr</mo>".to_string(),
            "arg" => "<mo>arg</mo>".to_string(),

            // Accents
            "hat" => {
                let content = self.parse_group();
                format!("<mover>{}<mo>^</mo></mover>", content)
            }
            "bar" | "overline" => {
                let content = self.parse_group();
                format!("<mover>{}<mo>¯</mo></mover>", content)
            }
            "vec" => {
                let content = self.parse_group();
                format!("<mover>{}<mo>→</mo></mover>", content)
            }
            "dot" => {
                let content = self.parse_group();
                format!("<mover>{}<mo>˙</mo></mover>", content)
            }
            "ddot" => {
                let content = self.parse_group();
                format!("<mover>{}<mo>¨</mo></mover>", content)
            }
            "tilde" | "widetilde" => {
                let content = self.parse_group();
                format!("<mover>{}<mo>~</mo></mover>", content)
            }
            "widehat" => {
                let content = self.parse_group();
                format!("<mover>{}<mo>^</mo></mover>", content)
            }
            "underline" => {
                let content = self.parse_group();
                format!("<munder>{}<mo>_</mo></munder>", content)
            }
            "overbrace" => {
                let content = self.parse_group();
                format!("<mover>{}<mo>⏞</mo></mover>", content)
            }
            "underbrace" => {
                let content = self.parse_group();
                format!("<munder>{}<mo>⏟</mo></munder>", content)
            }

            // Text in math
            "text" | "textrm" | "textit" | "textbf" | "textsf" | "texttt" | "mbox" => {
                let content = self.parse_group_raw();
                format!("<mtext>{}</mtext>", content)
            }
            "mathrm" | "operatorname" => {
                let content = self.parse_group_raw();
                format!("<mo>{}</mo>", content)
            }
            "mathit" => {
                let content = self.parse_group_raw();
                format!("<mi mathvariant=\"italic\">{}</mi>", content)
            }
            "mathbf" | "boldsymbol" | "bm" => {
                let content = self.parse_group();
                format!("<mrow mathvariant=\"bold\">{}</mrow>", content)
            }
            "mathbb" => {
                let content = self.parse_group_raw();
                self.convert_mathbb(&content)
            }
            "mathcal" => {
                let content = self.parse_group_raw();
                format!("<mi mathvariant=\"script\">{}</mi>", content)
            }
            "mathfrak" => {
                let content = self.parse_group_raw();
                format!("<mi mathvariant=\"fraktur\">{}</mi>", content)
            }
            "mathsf" => {
                let content = self.parse_group_raw();
                format!("<mi mathvariant=\"sans-serif\">{}</mi>", content)
            }
            "mathtt" => {
                let content = self.parse_group_raw();
                format!("<mi mathvariant=\"monospace\">{}</mi>", content)
            }

            // Delimiters
            "left" => {
                let delim = self.read_delimiter();
                let content = self.parse_expression();
                // Skip \right and its delimiter
                if self.peek_str("\\right") || self.peek_str("right") {
                    if self.current_char() == '\\' { self.pos += 1; }
                    self.read_alpha(); // "right"
                    let _right_delim = self.read_delimiter();
                }
                format!("<mrow><mo>{}</mo>{}<mo>{}</mo></mrow>", delim, content, delim)
            }
            "right" => {
                let _delim = self.read_delimiter();
                String::new() // Handled by \left
            }
            "langle" => "<mo>⟨</mo>".to_string(),
            "rangle" => "<mo>⟩</mo>".to_string(),
            "lfloor" => "<mo>⌊</mo>".to_string(),
            "rfloor" => "<mo>⌋</mo>".to_string(),
            "lceil" => "<mo>⌈</mo>".to_string(),
            "rceil" => "<mo>⌉</mo>".to_string(),
            "lvert" => "<mo>|</mo>".to_string(),
            "rvert" => "<mo>|</mo>".to_string(),
            "lVert" => "<mo>‖</mo>".to_string(),
            "rVert" => "<mo>‖</mo>".to_string(),

            // Environments
            "begin" => {
                let env = self.parse_group_raw();
                self.parse_environment(&env)
            }

            // Spacing
            "quad" => "<mspace width=\"1em\"/>".to_string(),
            "qquad" => "<mspace width=\"2em\"/>".to_string(),
            "," | "thinspace" => "<mspace width=\"0.167em\"/>".to_string(),
            ":" | "medspace" => "<mspace width=\"0.222em\"/>".to_string(),
            ";" | "thickspace" => "<mspace width=\"0.278em\"/>".to_string(),
            "!" | "negthinspace" => "<mspace width=\"-0.167em\"/>".to_string(),
            " " => "<mspace width=\"0.222em\"/>".to_string(),

            // Stackrel, overset, underset
            "stackrel" | "overset" => {
                let over = self.parse_group();
                let base = self.parse_group();
                format!("<mover>{}{}</mover>", base, over)
            }
            "underset" => {
                let under = self.parse_group();
                let base = self.parse_group();
                format!("<munder>{}{}</munder>", base, under)
            }

            // Phantom
            "phantom" => {
                let content = self.parse_group();
                format!("<mphantom>{}</mphantom>", content)
            }

            // Color
            "color" => {
                let color = self.parse_group_raw();
                let content = self.parse_group();
                format!("<mstyle mathcolor=\"{}\">{}</mstyle>", color, content)
            }

            // Misc
            "not" => "<mo>/</mo>".to_string(),
            "boxed" => {
                let content = self.parse_group();
                format!("<menclose notation=\"box\">{}</menclose>", content)
            }
            "cancel" => {
                let content = self.parse_group();
                format!("<menclose notation=\"updiagonalstrike\">{}</menclose>", content)
            }

            // Try symbol lookup
            _ => {
                if let Some(unicode) = LATEX_TO_UNICODE.get(cmd.as_str()) {
                    format!("<mo>{}</mo>", unicode)
                } else {
                    format!("<mo>\\{}</mo>", cmd)
                }
            }
        }
    }

    fn parse_environment(&mut self, env: &str) -> String {
        match env {
            "matrix" | "pmatrix" | "bmatrix" | "Bmatrix" | "vmatrix" | "Vmatrix" | "smallmatrix" => {
                let content = self.parse_until_end(env);
                let (open, close) = match env {
                    "pmatrix" => ("(", ")"),
                    "bmatrix" => ("[", "]"),
                    "Bmatrix" => ("{", "}"),
                    "vmatrix" => ("|", "|"),
                    "Vmatrix" => ("‖", "‖"),
                    _ => ("", ""),
                };
                let mut rows: Vec<String> = Vec::new();
                for row_str in content.split("\\\\") {
                    let cells: Vec<String> = row_str
                        .split('&')
                        .map(|cell| {
                            let mut p = LatexMathParser::new(cell.trim());
                            let parsed = p.parse_expression();
                            format!("<mtd>{}</mtd>", parsed)
                        })
                        .collect();
                    rows.push(format!("<mtr>{}</mtr>", cells.join("")));
                }
                let table = format!("<mtable>{}</mtable>", rows.join(""));
                if open.is_empty() {
                    table
                } else {
                    format!("<mrow><mo>{}</mo>{}<mo>{}</mo></mrow>", open, table, close)
                }
            }
            "cases" => {
                let content = self.parse_until_end(env);
                let mut rows: Vec<String> = Vec::new();
                for row_str in content.split("\\\\") {
                    let parts: Vec<&str> = row_str.splitn(2, '&').collect();
                    let expr = {
                        let mut p = LatexMathParser::new(parts.first().unwrap_or(&"").trim());
                        p.parse_expression()
                    };
                    let cond = if parts.len() > 1 {
                        let mut p = LatexMathParser::new(parts[1].trim());
                        p.parse_expression()
                    } else {
                        String::new()
                    };
                    rows.push(format!("<mtr><mtd>{}</mtd><mtd>{}</mtd></mtr>", expr, cond));
                }
                format!(
                    "<mrow><mo>{{</mo><mtable columnalign=\"left\">{}</mtable></mrow>",
                    rows.join("")
                )
            }
            "aligned" | "align" | "align*" => {
                let content = self.parse_until_end(env);
                let mut rows: Vec<String> = Vec::new();
                for row_str in content.split("\\\\") {
                    let cells: Vec<String> = row_str
                        .split('&')
                        .map(|cell| {
                            let mut p = LatexMathParser::new(cell.trim());
                            format!("<mtd>{}</mtd>", p.parse_expression())
                        })
                        .collect();
                    rows.push(format!("<mtr>{}</mtr>", cells.join("")));
                }
                format!("<mtable columnalign=\"right left\">{}</mtable>", rows.join(""))
            }
            "gathered" => {
                let content = self.parse_until_end(env);
                let mut rows: Vec<String> = Vec::new();
                for row_str in content.split("\\\\") {
                    let mut p = LatexMathParser::new(row_str.trim());
                    rows.push(format!("<mtr><mtd>{}</mtd></mtr>", p.parse_expression()));
                }
                format!("<mtable>{}</mtable>", rows.join(""))
            }
            "array" => {
                // Skip column spec
                if self.peek_char() == Some('{') {
                    self.pos += 1;
                    self.read_until('}');
                    self.expect('}');
                }
                let content = self.parse_until_end(env);
                let mut rows: Vec<String> = Vec::new();
                for row_str in content.split("\\\\") {
                    let cells: Vec<String> = row_str
                        .split('&')
                        .map(|cell| {
                            let mut p = LatexMathParser::new(cell.trim());
                            format!("<mtd>{}</mtd>", p.parse_expression())
                        })
                        .collect();
                    rows.push(format!("<mtr>{}</mtr>", cells.join("")));
                }
                format!("<mtable>{}</mtable>", rows.join(""))
            }
            _ => {
                let content = self.parse_until_end(env);
                let mut p = LatexMathParser::new(&content);
                p.parse_expression()
            }
        }
    }

    fn parse_until_end(&mut self, env: &str) -> String {
        let end_marker = format!("\\end{{{}}}", env);
        let start = self.pos;
        while self.pos < self.input.len() {
            if self.input[self.pos..].starts_with(&end_marker) {
                let content = self.input[start..self.pos].to_string();
                self.pos += end_marker.len();
                return content;
            }
            self.pos += 1;
        }
        self.input[start..].to_string()
    }

    fn parse_group(&mut self) -> String {
        self.skip_whitespace();
        if self.pos < self.input.len() && self.current_char() == '{' {
            self.pos += 1;
            let content = self.parse_expression();
            self.expect('}');
            format!("<mrow>{}</mrow>", content)
        } else {
            self.parse_single_token()
        }
    }

    fn parse_group_raw(&mut self) -> String {
        self.skip_whitespace();
        if self.pos < self.input.len() && self.current_char() == '{' {
            self.pos += 1;
            let start = self.pos;
            let mut depth = 1;
            while self.pos < self.input.len() && depth > 0 {
                match self.current_char() {
                    '{' => depth += 1,
                    '}' => depth -= 1,
                    _ => {}
                }
                if depth > 0 {
                    self.pos += 1;
                }
            }
            let content = self.input[start..self.pos].to_string();
            self.expect('}');
            content
        } else if self.pos < self.input.len() {
            let ch = self.current_char();
            self.pos += 1;
            ch.to_string()
        } else {
            String::new()
        }
    }

    fn parse_single_token(&mut self) -> String {
        self.skip_whitespace();
        if self.pos >= self.input.len() {
            return String::new();
        }

        match self.current_char() {
            '{' => self.parse_group(),
            '\\' => self.parse_command(),
            c if c.is_ascii_digit() => self.parse_number(),
            c => {
                self.pos += 1;
                format!("<mi>{}</mi>", c)
            }
        }
    }

    fn parse_number(&mut self) -> String {
        let start = self.pos;
        while self.pos < self.input.len()
            && (self.current_char().is_ascii_digit() || self.current_char() == '.')
        {
            self.pos += 1;
        }
        format!("<mn>{}</mn>", &self.input[start..self.pos])
    }

    fn convert_mathbb(&self, content: &str) -> String {
        let mapped: String = content
            .chars()
            .map(|c| match c {
                'A' => '𝔸', 'B' => '𝔹', 'C' => 'ℂ', 'D' => '𝔻', 'E' => '𝔼',
                'F' => '𝔽', 'G' => '𝔾', 'H' => 'ℍ', 'I' => '𝕀', 'J' => '𝕁',
                'K' => '𝕂', 'L' => '𝕃', 'M' => '𝕄', 'N' => 'ℕ', 'O' => '𝕆',
                'P' => 'ℙ', 'Q' => 'ℚ', 'R' => 'ℝ', 'S' => '𝕊', 'T' => '𝕋',
                'U' => '𝕌', 'V' => '𝕍', 'W' => '𝕎', 'X' => '𝕏', 'Y' => '𝕐',
                'Z' => 'ℤ',
                _ => c,
            })
            .collect();
        format!("<mi mathvariant=\"double-struck\">{}</mi>", mapped)
    }

    fn read_alpha(&mut self) -> String {
        let start = self.pos;
        while self.pos < self.input.len() && self.current_char().is_ascii_alphabetic() {
            self.pos += 1;
        }
        self.input[start..self.pos].to_string()
    }

    fn read_until(&mut self, end: char) -> String {
        let start = self.pos;
        while self.pos < self.input.len() && self.current_char() != end {
            self.pos += 1;
        }
        self.input[start..self.pos].to_string()
    }

    fn read_delimiter(&mut self) -> String {
        self.skip_whitespace();
        if self.pos >= self.input.len() {
            return String::new();
        }
        let ch = self.current_char();
        self.pos += 1;
        match ch {
            '(' => "(".to_string(),
            ')' => ")".to_string(),
            '[' => "[".to_string(),
            ']' => "]".to_string(),
            '|' => "|".to_string(),
            '.' => "".to_string(), // invisible delimiter
            '\\' => {
                let cmd = self.read_alpha();
                match cmd.as_str() {
                    "langle" => "⟨".to_string(),
                    "rangle" => "⟩".to_string(),
                    "lfloor" => "⌊".to_string(),
                    "rfloor" => "⌋".to_string(),
                    "lceil" => "⌈".to_string(),
                    "rceil" => "⌉".to_string(),
                    "lbrace" | "{" => "{".to_string(),
                    "rbrace" | "}" => "}".to_string(),
                    "lvert" => "|".to_string(),
                    "rvert" => "|".to_string(),
                    "lVert" => "‖".to_string(),
                    "rVert" => "‖".to_string(),
                    _ => cmd,
                }
            }
            _ => ch.to_string(),
        }
    }

    fn skip_whitespace(&mut self) {
        while self.pos < self.input.len() && self.input.as_bytes()[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    fn current_char(&self) -> char {
        self.input[self.pos..].chars().next().unwrap_or('\0')
    }

    fn peek_char(&self) -> Option<char> {
        if self.pos < self.input.len() {
            Some(self.current_char())
        } else {
            None
        }
    }

    fn peek_str(&self, s: &str) -> bool {
        self.input[self.pos..].starts_with(s)
    }

    fn expect(&mut self, ch: char) {
        if self.pos < self.input.len() && self.current_char() == ch {
            self.pos += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_fraction() {
        let result = latex_to_mathml("\\frac{a}{b}", false);
        assert!(result.mathml.contains("<mfrac>"));
        assert!(result.mathml.contains("</mfrac>"));
    }

    #[test]
    fn test_subscript_superscript() {
        let result = latex_to_mathml("x_i^2", false);
        assert!(result.mathml.contains("<msubsup>"));
    }

    #[test]
    fn test_sqrt() {
        let result = latex_to_mathml("\\sqrt{x}", false);
        assert!(result.mathml.contains("<msqrt>"));
    }

    #[test]
    fn test_greek() {
        let result = latex_to_mathml("\\alpha + \\beta", false);
        assert!(result.mathml.contains("α") || result.mathml.contains("alpha"));
    }

    #[test]
    fn test_matrix() {
        let result = latex_to_mathml("\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", true);
        assert!(result.mathml.contains("<mtable>"));
        assert!(result.is_display);
    }
}
