"use client";

import React, { useRef, useCallback } from "react";
import Editor, { type OnMount, type Monaco } from "@monaco-editor/react";
import { useEditorStore } from "@/lib/stores";
import { Loader2 } from "lucide-react";

// LaTeX language configuration for Monaco
function registerLatexLanguage(monaco: Monaco) {
  // Register LaTeX language if not already registered
  const languages = monaco.languages.getLanguages();
  if (languages.some((l) => l.id === "latex")) return;

  monaco.languages.register({ id: "latex" });

  monaco.languages.setMonarchTokensProvider("latex", {
    tokenizer: {
      root: [
        // Comments
        [/%.*$/, "comment"],
        // Commands
        [/\\[a-zA-Z@]+/, "keyword"],
        // Math mode
        [/\$\$/, { token: "string", next: "@mathDisplay" }],
        [/\$/, { token: "string", next: "@mathInline" }],
        // Braces
        [/[{}]/, "delimiter.curly"],
        [/[[\]]/, "delimiter.square"],
        // Environment begin/end
        [
          /\\begin\{([^}]*)\}/,
          "tag",
        ],
        [
          /\\end\{([^}]*)\}/,
          "tag",
        ],
        // Special characters
        [/[&~^_]/, "operator"],
      ],
      mathDisplay: [
        [/[^$]+/, "string"],
        [/\$\$/, { token: "string", next: "@pop" }],
      ],
      mathInline: [
        [/[^$]+/, "string"],
        [/\$/, { token: "string", next: "@pop" }],
      ],
    },
  });

  // Custom theme for the editor
  monaco.editor.defineTheme("wordtex-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6A9955", fontStyle: "italic" },
      { token: "keyword", foreground: "C586C0" },
      { token: "string", foreground: "CE9178" },
      { token: "tag", foreground: "569CD6" },
      { token: "delimiter.curly", foreground: "FFD700" },
      { token: "delimiter.square", foreground: "DA70D6" },
      { token: "operator", foreground: "D4D4D4" },
    ],
    colors: {
      "editor.background": "#0a0a0c",
      "editor.foreground": "#D4D4D4",
      "editorLineNumber.foreground": "#3a3a4a",
      "editorLineNumber.activeForeground": "#6d5ff5",
      "editor.selectionBackground": "#6d5ff533",
      "editor.lineHighlightBackground": "#ffffff06",
      "editorCursor.foreground": "#6d5ff5",
    },
  });

  // LaTeX auto-completions
  monaco.languages.registerCompletionItemProvider("latex", {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = [
        { label: "\\begin{}", insertText: "\\begin{${1:environment}}\n\t$0\n\\end{${1:environment}}", detail: "Begin environment" },
        { label: "\\section{}", insertText: "\\section{${1:title}}", detail: "Section heading" },
        { label: "\\subsection{}", insertText: "\\subsection{${1:title}}", detail: "Subsection heading" },
        { label: "\\textbf{}", insertText: "\\textbf{${1:text}}", detail: "Bold text" },
        { label: "\\textit{}", insertText: "\\textit{${1:text}}", detail: "Italic text" },
        { label: "\\cite{}", insertText: "\\cite{${1:key}}", detail: "Citation" },
        { label: "\\ref{}", insertText: "\\ref{${1:label}}", detail: "Cross reference" },
        { label: "\\label{}", insertText: "\\label{${1:name}}", detail: "Label" },
        { label: "\\frac{}{}", insertText: "\\frac{${1:num}}{${2:den}}", detail: "Fraction" },
        { label: "\\sqrt{}", insertText: "\\sqrt{${1:expression}}", detail: "Square root" },
        { label: "\\sum", insertText: "\\sum_{${1:i=0}}^{${2:n}}", detail: "Summation" },
        { label: "\\int", insertText: "\\int_{${1:a}}^{${2:b}}", detail: "Integral" },
        { label: "\\alpha", insertText: "\\alpha", detail: "Greek: alpha" },
        { label: "\\beta", insertText: "\\beta", detail: "Greek: beta" },
        { label: "\\gamma", insertText: "\\gamma", detail: "Greek: gamma" },
        { label: "\\usepackage{}", insertText: "\\usepackage{${1:package}}", detail: "Use package" },
        { label: "\\documentclass{}", insertText: "\\documentclass{${1:class}}", detail: "Document class" },
        { label: "\\includegraphics{}", insertText: "\\includegraphics[width=${1:0.8}\\textwidth]{${2:file}}", detail: "Include image" },
        { label: "\\table", insertText: "\\begin{table}[${1:htbp}]\n\t\\centering\n\t\\caption{${2:caption}}\n\t\\label{tab:${3:label}}\n\t\\begin{tabular}{${4:cc}}\n\t\t\\hline\n\t\t$0\n\t\t\\hline\n\t\\end{tabular}\n\\end{table}", detail: "Table environment" },
        { label: "\\figure", insertText: "\\begin{figure}[${1:htbp}]\n\t\\centering\n\t\\includegraphics[width=${2:0.8}\\textwidth]{${3:file}}\n\t\\caption{${4:caption}}\n\t\\label{fig:${5:label}}\n\\end{figure}", detail: "Figure environment" },
        { label: "\\equation", insertText: "\\begin{equation}\n\t${1:expression}\n\t\\label{eq:${2:label}}\n\\end{equation}", detail: "Equation environment" },
      ].map((s) => ({
        ...s,
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
      }));

      return { suggestions };
    },
    triggerCharacters: ["\\"],
  });
}

export function SourceEditor() {
  const {
    sourceContent,
    sourceLanguage,
    editorFontSize,
    setSourceContent,
  } = useEditorStore();

  const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      registerLatexLanguage(monaco);
      monaco.editor.setTheme("wordtex-dark");
      editor.focus();
    },
    []
  );

  return (
    <div className="h-full w-full overflow-hidden">
      <Editor
        height="100%"
        language={sourceLanguage}
        value={sourceContent}
        onChange={(value) => setSourceContent(value ?? "")}
        onMount={handleMount}
        loading={
          <div className="flex h-full items-center justify-center bg-background">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        }
        options={{
          fontSize: editorFontSize,
          fontFamily: "var(--font-mono), 'JetBrains Mono', monospace",
          fontLigatures: true,
          minimap: { enabled: false },
          wordWrap: "on",
          lineNumbers: "on",
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          padding: { top: 16, bottom: 16 },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          bracketPairColorization: { enabled: true },
          automaticLayout: true,
          tabSize: 2,
          suggest: {
            showSnippets: true,
            showKeywords: true,
          },
        }}
      />
    </div>
  );
}
