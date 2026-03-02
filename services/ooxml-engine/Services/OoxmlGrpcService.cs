namespace WordTex.OoxmlEngine.Services;

/// <summary>
/// Placeholder gRPC service for OOXML operations.
/// In production this exposes SirToOoxml, OoxmlToSir, and related RPCs.
/// </summary>
public class OoxmlGrpcService
{
    private readonly DocumentService _documentService;
    private readonly StyleService _styleService;
    private readonly MathService _mathService;
    private readonly ILogger<OoxmlGrpcService> _logger;

    public OoxmlGrpcService(
        DocumentService documentService,
        StyleService styleService,
        MathService mathService,
        ILogger<OoxmlGrpcService> logger)
    {
        _documentService = documentService;
        _styleService = styleService;
        _mathService = mathService;
        _logger = logger;
    }

    // In production, these methods are generated from the proto definition
    // and implement the SirTransformService gRPC service.

    public byte[] SirToOoxml(string sirJson, string template)
    {
        _logger.LogInformation("Converting SIR to OOXML with template {Template}", template);
        return _documentService.BuildDocx(sirJson, template);
    }

    public string OoxmlToSir(byte[] docxBytes)
    {
        _logger.LogInformation("Converting OOXML to SIR");
        return _documentService.ParseDocx(docxBytes);
    }

    public string ConvertMathToOMML(string mathml)
    {
        return _mathService.MathMLToOMML(mathml);
    }

    public string ConvertOMMLToMathML(string omml)
    {
        return _mathService.OMMLToMathML(omml);
    }
}
