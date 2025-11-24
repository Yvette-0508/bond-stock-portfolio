import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List

import yaml
from alpaca_trade_api.rest import REST
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)


def load_accounts_from_config(config_path: str = "portfolio_config.yaml") -> List[Dict[str, Any]]:
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
    import numpy as np
    
    if len(equity_values) < 2:
        return {"volatility": 0.0, "sharpe_ratio": 0.0, "max_drawdown": 0.0}
    
    equity_array = np.array(equity_values, dtype=float)
    returns = np.diff(equity_array) / equity_array[:-1]
    
    volatility = np.std(returns) * np.sqrt(252) * 100
    mean_return = np.mean(returns)
    sharpe_ratio = (mean_return / np.std(returns)) * np.sqrt(252) if np.std(returns) > 0 else 0.0
    
    cumulative = np.cumprod(1 + returns)
    running_max = np.maximum.accumulate(cumulative)
    drawdown = (cumulative - running_max) / running_max
    max_drawdown = np.min(drawdown) * 100
    
    return {
        "volatility": float(volatility),
        "sharpe_ratio": float(sharpe_ratio),
        "max_drawdown": float(max_drawdown),
    }


def get_portfolio_history(account: Dict[str, Any], period: str = "1M", timeframe: str = "1D") -> Dict[str, Any]:
    rest = REST(
        key_id=account["key_id"],
        secret_key=account["secret_key"],
        base_url=account["base_url"]
    )
    
    try:
        history = rest.get_portfolio_history(period=period, timeframe=timeframe)
        account_info = rest.get_account()
        metrics = calculate_metrics(history.equity)
        
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
    return render_template("index.html")


@app.route("/api/accounts")
def get_accounts():
    accounts = load_accounts_from_config()
    return jsonify([{"name": acc["name"]} for acc in accounts])


def get_benchmark_history(symbol: str = "SPY", period: str = "1M", timeframe: str = "1D") -> Dict[str, Any]:
    accounts = load_accounts_from_config()
    if not accounts:
        return {}
        
    rest = REST(
        key_id=accounts[0]["key_id"],
        secret_key=accounts[0]["secret_key"],
        base_url=accounts[0]["base_url"]
    )
    
    try:
        now = datetime.now()
        if period == "1D":
            start = now - timedelta(days=1)
        elif period == "1W":
            start = now - timedelta(weeks=1)
        elif period == "1M":
            start = now - timedelta(days=30)
        elif period == "3M":
            start = now - timedelta(days=90)
        elif period == "1Y":
            start = now - timedelta(days=365)
        else:
            start = now - timedelta(days=365*5)
            
        bars = rest.get_bars(symbol, timeframe, start=start.isoformat(), end=now.isoformat(), limit=10000).df
        
        if bars.empty:
            return {}
        
        return {
            "symbol": symbol,
            "timestamps": [ts.strftime("%Y-%m-%d %H:%M") for ts in bars.index],
            "close": bars["close"].tolist()
        }
    except Exception as e:
        return {}


def calculate_beta(portfolio_returns: List[float], benchmark_returns: List[float]) -> float:
    import numpy as np
    
    if len(portfolio_returns) != len(benchmark_returns) or len(portfolio_returns) < 2:
        return 0.0
        
    min_len = min(len(portfolio_returns), len(benchmark_returns))
    p_ret = np.array(portfolio_returns[:min_len])
    b_ret = np.array(benchmark_returns[:min_len])
    
    covariance = np.cov(p_ret, b_ret)[0][1]
    variance = np.var(b_ret)
    
    return covariance / variance if variance > 0 else 0.0


@app.route("/api/portfolio-history/<period>")
def portfolio_history(period: str = "1M"):
    benchmark_symbol = request.args.get('benchmark', 'SPY')
    
    timeframe_map = {
        "1D": "5Min",
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
    
    benchmark_data = {}
    if benchmark_symbol != 'None':
        benchmark_data = get_benchmark_history(benchmark_symbol, period, timeframe)
    
    histories = [get_portfolio_history(account, period=period, timeframe=timeframe) for account in accounts]
    
    return jsonify({
        "accounts": histories,
        "benchmark": benchmark_data
    })


@app.route("/api/account-summary")
def account_summary():
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
            
            current_equity = float(acc_info.equity)
            last_equity = float(acc_info.last_equity)
            day_pnl = current_equity - last_equity
            
            summaries.append({
                "name": account["name"],
                "equity": current_equity,
                "cash": float(acc_info.cash),
                "buying_power": float(acc_info.buying_power),
                "portfolio_value": float(acc_info.portfolio_value),
                "positions_count": len(positions),
                "day_profit_loss": day_pnl,
                "day_profit_loss_pct": (day_pnl / last_equity * 100) if last_equity > 0 else 0,
            })
        except Exception as e:
            summaries.append({"name": account["name"], "error": str(e)})
        
    try:
        if accounts:
            spy_trade = rest.get_latest_trade("SPY")
            spy_bars = rest.get_bars("SPY", "1D", limit=2).df
            
            if not spy_bars.empty and len(spy_bars) >= 2:
                prev_close = spy_bars.iloc[-2]["close"]
                current_price = float(spy_trade.price)
                spy_change = current_price - prev_close
                spy_change_pct = (spy_change / prev_close) * 100
                
                summaries.append({
                    "name": "S&P 500 (SPY)",
                    "equity": current_price,
                    "day_profit_loss": spy_change,
                    "day_profit_loss_pct": spy_change_pct,
                    "is_market": True
                })
    except Exception:
        pass
    
    return jsonify(summaries)


def get_asset_class(symbol: str) -> str:
    ASSET_CLASSES = {
        "Equity": ["VOO", "QQQ", "VEA", "VWO"],
        "Fixed Income": ["VTEB", "TIP", "IEF", "SHYG", "BND"],
        "Real Estate": ["VNQ"],
        "Commodities": ["GLD"],
    }
    
    for category, symbols in ASSET_CLASSES.items():
        if symbol in symbols:
            return category
    return "Other"


@app.route("/api/risk-metrics")
def risk_metrics():
    accounts = load_accounts_from_config()
    
    asset_allocation = {
        "Equity": 0.0,
        "Fixed Income": 0.0,
        "Real Estate": 0.0,
        "Commodities": 0.0,
        "Other": 0.0,
        "Cash": 0.0
    }
    
    all_positions = []
    
    for account in accounts:
        rest = REST(
            key_id=account["key_id"],
            secret_key=account["secret_key"],
            base_url=account["base_url"]
        )
        
        try:
            positions = rest.list_positions()
            account_info = rest.get_account()
            
            asset_allocation["Cash"] += float(account_info.cash)
            
            for pos in positions:
                market_value = float(pos.market_value)
                symbol = pos.symbol
                asset_class = get_asset_class(symbol)
                
                if asset_class in asset_allocation:
                    asset_allocation[asset_class] += market_value
                else:
                    asset_allocation["Other"] += market_value
                
                all_positions.append({
                    "symbol": symbol,
                    "market_value": market_value,
                    "pl_pct": float(pos.unrealized_plpc) * 100,
                    "pl_day_pct": float(pos.change_today) * 100,
                    "account": account["name"]
                })
                
        except Exception:
            pass
            
    top_gainers = sorted(all_positions, key=lambda x: x["pl_day_pct"], reverse=True)[:5]
    top_losers = sorted(all_positions, key=lambda x: x["pl_day_pct"])[:5]
    
    return jsonify({
        "allocation": asset_allocation,
        "top_gainers": top_gainers,
        "top_losers": top_losers
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(debug=False, host="0.0.0.0", port=port)

