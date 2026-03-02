use criterion::{black_box, criterion_group, criterion_main, Criterion};
use sir_core::model::document::*;
use sir_core::model::metadata::*;
use sir_core::model::types::*;

fn create_sample_document() -> SirDocument {
    let mut doc = SirDocument::default();
    doc.metadata.title = "Benchmark Document: Analysis of Convergent Sequences".into();
    doc.metadata.authors.push(AuthorInfo {
        name: "Jane Doe".into(),
        affiliations: vec!["MIT".into()],
        email: Some("jane@mit.edu".into()),
        orcid: None,
    });

    // Add a mix of blocks to simulate realistic document
    for i in 0..50 {
        // Heading
        if i % 10 == 0 {
            doc.body.push(Block::Heading(Heading {
                level: if i == 0 { 1 } else { 2 },
                content: vec![Inline::Text(TextNode {
                    content: format!("Section {}", i / 10 + 1),
                    style: TextStyle::default(),
                })],
                label: Some(format!("sec:{}", i / 10 + 1)),
                numbered: true,
            }));
        }

        // Paragraph
        doc.body.push(Block::Paragraph(Paragraph {
            content: vec![Inline::Text(TextNode {
                content: format!("This is paragraph {} with some content for benchmarking.", i),
                style: TextStyle::default(),
            })],
            style: ParagraphStyle::default(),
        }));

        // Math block every 5 paragraphs
        if i % 5 == 0 {
            doc.body.push(Block::MathBlock(MathBlock {
                latex: format!("\\sum_{{i=1}}^{{{}}} x_i^2 = \\frac{{n(n+1)(2n+1)}}{{6}}", i + 1),
                label: Some(format!("eq:{}", i / 5)),
                numbered: true,
                environment: "equation".into(),
            }));
        }
    }

    doc
}

fn bench_serialization(c: &mut Criterion) {
    let doc = create_sample_document();

    c.bench_function("sir_serialize_json", |b| {
        b.iter(|| {
            let json = serde_json::to_string(black_box(&doc)).unwrap();
            black_box(json);
        });
    });

    let json = serde_json::to_string(&doc).unwrap();
    c.bench_function("sir_deserialize_json", |b| {
        b.iter(|| {
            let doc: SirDocument = serde_json::from_str(black_box(&json)).unwrap();
            black_box(doc);
        });
    });
}

fn bench_document_creation(c: &mut Criterion) {
    c.bench_function("sir_create_50_block_doc", |b| {
        b.iter(|| {
            let doc = create_sample_document();
            black_box(doc);
        });
    });
}

fn bench_anchor_resolution(c: &mut Criterion) {
    let mut doc = create_sample_document();

    // Populate anchor store
    for (i, block) in doc.body.iter().enumerate() {
        match block {
            Block::Heading(h) => {
                if let Some(label) = &h.label {
                    doc.anchor_store.insert(
                        label.clone(),
                        sir_core::model::document::Anchor {
                            id: format!("anchor-{}", i),
                            label: label.clone(),
                            kind: "section".into(),
                            resolved_text: format!("{}", i / 10 + 1),
                            page_number: None,
                        },
                    );
                }
            }
            Block::MathBlock(m) => {
                if let Some(label) = &m.label {
                    doc.anchor_store.insert(
                        label.clone(),
                        sir_core::model::document::Anchor {
                            id: format!("anchor-{}", i),
                            label: label.clone(),
                            kind: "equation".into(),
                            resolved_text: format!("({})", i / 5),
                            page_number: None,
                        },
                    );
                }
            }
            _ => {}
        }
    }

    c.bench_function("sir_anchor_lookup", |b| {
        b.iter(|| {
            for key in doc.anchor_store.keys() {
                black_box(doc.anchor_store.get(key));
            }
        });
    });
}

criterion_group!(
    benches,
    bench_serialization,
    bench_document_creation,
    bench_anchor_resolution
);
criterion_main!(benches);
