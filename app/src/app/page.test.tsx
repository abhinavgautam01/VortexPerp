import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Metric, SkeletonMetric, ActionStatus } from "../components/ui";

describe("UI Components", () => {
  describe("Metric", () => {
    it("renders label and value correctly", () => {
      render(<Metric label="Mark price" value="$100.50" />);
      
      expect(screen.getByText("Mark price")).toBeInTheDocument();
      expect(screen.getByText("$100.50")).toBeInTheDocument();
    });

    it("applies valueClass when provided", () => {
      render(<Metric label="Unrealized PnL" value="+$5.00" valueClass="pnl-positive" />);
      
      const valueElement = screen.getByText("+$5.00");
      expect(valueElement).toHaveClass("pnl-positive");
    });
  });

  describe("SkeletonMetric", () => {
    it("renders a skeleton with appropriate classes", () => {
      render(<SkeletonMetric />);
      
      const metricContainer = screen.getByTestId("skeleton-metric");
      expect(metricContainer).toBeInTheDocument();
      expect(metricContainer).toHaveClass("skeleton");
      expect(metricContainer.querySelector(".skeleton-label")).toBeInTheDocument();
      expect(metricContainer.querySelector(".skeleton-value")).toBeInTheDocument();
    });
  });

  describe("ActionStatus", () => {
    it("renders idle state correctly", () => {
      render(<ActionStatus state={{ status: "idle", message: "Awaiting input" }} />);
      
      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.getByText("Awaiting input")).toBeInTheDocument();
    });

    it("renders pending state correctly", () => {
      render(<ActionStatus state={{ status: "pending", message: "Processing..." }} />);
      
      expect(screen.getByText("Pending")).toBeInTheDocument();
      expect(screen.getByText("Processing...")).toBeInTheDocument();
    });

    it("renders error state correctly", () => {
      render(<ActionStatus state={{ status: "error", message: "Failed to fetch" }} />);
      
      expect(screen.getByText("Action failed")).toBeInTheDocument();
      expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    });

    it("renders success state with signature correctly", () => {
      render(
        <ActionStatus 
          state={{ 
            status: "success", 
            message: "Trade complete", 
            signature: "12345abcdef" 
          }} 
        />
      );
      
      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.getByText("Trade complete")).toBeInTheDocument();
      
      const link = screen.getByRole("link", { name: /view transaction/i });
      expect(link).toHaveAttribute("href", "https://explorer.solana.com/tx/12345abcdef?cluster=devnet");
    });
  });
});
