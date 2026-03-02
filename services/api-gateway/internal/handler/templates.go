package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type TemplateInfo struct {
	Name        string   `json:"name"`
	DisplayName string   `json:"display_name"`
	LatexClass  string   `json:"latex_class"`
	DotxFile    string   `json:"dotx_file"`
	Publishers  []string `json:"publishers"`
	Description string   `json:"description"`
}

var templateRegistry = []TemplateInfo{
	{
		Name:        "ieeetran",
		DisplayName: "IEEE Transactions",
		LatexClass:  "IEEEtran",
		DotxFile:    "IEEEtran.dotx",
		Publishers:  []string{"IEEE"},
		Description: "IEEE conference and journal papers",
	},
	{
		Name:        "acmart",
		DisplayName: "ACM Article",
		LatexClass:  "acmart",
		DotxFile:    "acmart.dotx",
		Publishers:  []string{"ACM"},
		Description: "ACM conference proceedings and journals",
	},
	{
		Name:        "elsarticle",
		DisplayName: "Elsevier Article",
		LatexClass:  "elsarticle",
		DotxFile:    "elsarticle.dotx",
		Publishers:  []string{"Elsevier"},
		Description: "Elsevier journal submissions",
	},
	{
		Name:        "revtex",
		DisplayName: "REVTeX (APS)",
		LatexClass:  "revtex4-2",
		DotxFile:    "revtex.dotx",
		Publishers:  []string{"APS", "AIP", "AAPM"},
		Description: "APS Physical Review journals",
	},
	{
		Name:        "llncs",
		DisplayName: "Springer LNCS",
		LatexClass:  "llncs",
		DotxFile:    "llncs.dotx",
		Publishers:  []string{"Springer"},
		Description: "Springer Lecture Notes in Computer Science",
	},
	{
		Name:        "article",
		DisplayName: "Standard Article",
		LatexClass:  "article",
		DotxFile:    "article-default.dotx",
		Publishers:  []string{},
		Description: "Standard LaTeX article class",
	},
}

func ListTemplates(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"templates": templateRegistry,
		"count":     len(templateRegistry),
	})
}

func GetTemplate(c *gin.Context) {
	name := c.Param("name")
	for _, t := range templateRegistry {
		if t.Name == name {
			c.JSON(http.StatusOK, t)
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "Template not found"})
}
