package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
	Version string `json:"version"`
}

func Health(c *gin.Context) {
	c.JSON(http.StatusOK, healthResponse{
		Status:  "ok",
		Service: "api-gateway",
		Version: "0.1.0",
	})
}

func Readiness(c *gin.Context) {
	// TODO: Check downstream services (Redis, RabbitMQ, SIR Core)
	c.JSON(http.StatusOK, gin.H{"ready": true})
}
