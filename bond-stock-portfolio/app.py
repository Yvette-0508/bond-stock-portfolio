#!/usr/bin/env python3
"""
Flask web application for multi-account portfolio tracking and comparison.
Displays interactive charts comparing portfolio values across accounts.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List

import yaml
from alpaca_trade_api.rest import REST
from flask import Flask, jsonify, render_template

app = Flask(__name__)


def load_accounts_from_config(config_path: str = "portfolio_config.yaml") -> List[Dict[str, Any]]:
    """Load account configurations from YAML file."""
    config_file = Path(config_path)
    if not config_file.exists():
        return []
    
    raw = yaml.safe_load(config_file.read_text())
    accounts = []
    for entry in raw.get("accounts", []):
        accounts.append({
            "name": entry["name"],
            "key_id": entry["key_id"],
            "secret_key": entry["secret_key"],
            "base_url": entry.get("base_url", "https://paper-api.alpaca.markets"),
        })
    return accounts


def calculate_metrics(equity_values: List[float]) -> Dict[str, float]:
    """Calculate portfolio metrics including volatility and Sharpe ratio."""
    import numpy as np
    
    if len(equity_values) < 2:
        return {
            "volatility": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown": 0.0,
        }
    
    # Calculate daily returns
    equity_array = np.array(equity_values, dtype=float)
    returns = np.diff(equity_array) / equity_array[:-1]
    
    # Volatility (annualized standard deviation)
    volatility = np.std(returns) * np.sqrt(252) * 100  # Annualized %
    
    # Sharpe Ratio (assuming 0% risk-free rate)
    mean_return = np.mean(returns)
    sharpe_ratio = (mean_return / np.std(returns)) * np.sqrt(252) if np.std(returns) > 0 else 0.0
    
    # Maximum Drawdown
    cumulative = np.cumprod(1 + returns)
    running_max = np.maximum.accumulate(cumulative)
    drawdown = (cumulative - running_max) / running_max
    max_drawdown = np.min(drawdown) * 100  # Convert to %
    
    return {
        "volatility": float(volatility),
        "sharpe_ratio": float(sharpe_ratio),
        "max_drawdown": float(max_drawdown),
    }


def get_portfolio_history(account: Dict[str, Any], period: str = "1M", timeframe: str = "1D") -> Dict[str, Any]:
    """
    Fetch portfolio history for a given account.
    
    Args:
        account: Account config with credentials
        period: Time period (1D, 1W, 1M, 3M, 1Y, all)
        timeframe: Data granularity (1Min, 5Min, 15Min, 1H, 1D)
    
    Returns:
        Dictionary with timestamps, equity values, and calculated metrics
    """
    rest = REST(
        key_id=account["key_id"],
        secret_key=account["secret_key"],
        base_url=account["base_url"]
    )
    
    try:
        # Get portfolio history from Alpaca
        history = rest.get_portfolio_history(period=period, timeframe=timeframe)
        
        # Get current account info
        account_info = rest.get_account()
        
        # Calculate metrics
        metrics = calculate_metrics(history.equity)
        
        # Calculate cumulative PnL
        equity_values = list(history.equity)
        initial_equity = equity_values[0] if equity_values else 0
        pnl_values = [(eq - initial_equity) for eq in equity_values]
        pnl_pct_values = [((eq - initial_equity) / initial_equity * 100) if initial_equity > 0 else 0 for eq in equity_values]
        
        return {
            "name": account["name"],
            "timestamps": [datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") for ts in history.timestamp],
            "equity": history.equity,
            "pnl": pnl_values,
            "pnl_pct": pnl_pct_values,
            "current_equity": float(account_info.equity),
            "current_cash": float(account_info.cash),
            "buying_power": float(account_info.buying_power),
            "volatility": metrics["volatility"],
            "sharpe_ratio": metrics["sharpe_ratio"],
            "max_drawdown": metrics["max_drawdown"],
        }
    except Exception as e:
        print(f"Error fetching history for {account['name']}: {e}")
        return {
            "name": account["name"],
            "timestamps": [],
            "equity": [],
            "pnl": [],
            "pnl_pct": [],
            "volatility": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown": 0.0,
            "error": str(e)
        }


@app.route("/")
def index():
    """Render the main dashboard page."""
    return render_template("index.html")


@app.route("/api/accounts")
def get_accounts():
    """Return list of account names."""
    accounts = load_accounts_from_config()
    return jsonify([{"name": acc["name"]} for acc in accounts])


@app.route("/api/portfolio-history/<period>")
def portfolio_history(period: str = "1M"):
    """
    Get portfolio history for all accounts.
    
    Args:
        period: 1D, 1W, 1M, 3M, 1Y, or all
    """
    # Map period to timeframe for appropriate granularity
    timeframe_map = {
        "1D": "15Min",
        "1W": "1H",
        "1M": "1D",
        "3M": "1D",
        "1Y": "1D",
        "all": "1W"
    }
    
    timeframe = timeframe_map.get(period, "1D")
    accounts = load_accounts_from_config()
    
    if not accounts:
        return jsonify({"error": "No accounts configured"}), 404
    
    histories = []
    for account in accounts:
        history = get_portfolio_history(account, period=period, timeframe=timeframe)
        histories.append(history)
    
    return jsonify(histories)


@app.route("/api/account-summary")
def account_summary():
    """Get current summary for all accounts."""
    accounts = load_accounts_from_config()
    summaries = []
    
    for account in accounts:
        rest = REST(
            key_id=account["key_id"],
            secret_key=account["secret_key"],
            base_url=account["base_url"]
        )
        
        try:
            acc_info = rest.get_account()
            positions = rest.list_positions()
            
            summaries.append({
                "name": account["name"],
                "equity": float(acc_info.equity),
                "cash": float(acc_info.cash),
                "buying_power": float(acc_info.buying_power),
                "portfolio_value": float(acc_info.portfolio_value),
                "positions_count": len(positions),
                "day_profit_loss": float(acc_info.equity) - float(acc_info.last_equity),
                "day_profit_loss_pct": ((float(acc_info.equity) - float(acc_info.last_equity)) / float(acc_info.last_equity) * 100) if float(acc_info.last_equity) > 0 else 0,
            })
        except Exception as e:
            summaries.append({
                "name": account["name"],
                "error": str(e)
            })
    
    return jsonify(summaries)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8080)

