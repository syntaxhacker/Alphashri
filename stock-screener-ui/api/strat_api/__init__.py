from fastapi import APIRouter

from api.strat_api.strat_crud import (
    create_strategy,
    update_strategy,
    delete_strategy,
)
from api.strat_api.strat_query import (
    list_strategies,
    list_templates,
    list_all_variations,
    get_strategy,
    get_strategy_performance,
    get_strategy_trades,
    get_strategy_variations,
    list_bots,
    get_bot,
)

router = APIRouter(prefix="/api/strategies", tags=["strategies"])

router.add_api_route("", list_strategies, methods=["GET"])
router.add_api_route("/templates", list_templates, methods=["GET"])
router.add_api_route("/variations", list_all_variations, methods=["GET"])
router.add_api_route("/{strategy_id}", get_strategy, methods=["GET"])
router.add_api_route("", create_strategy, methods=["POST"])
router.add_api_route("/{strategy_id}", update_strategy, methods=["PUT"])
router.add_api_route("/{strategy_id}", delete_strategy, methods=["DELETE"])
router.add_api_route("/{strategy_id}/performance", get_strategy_performance, methods=["GET"])
router.add_api_route("/{strategy_id}/trades", get_strategy_trades, methods=["GET"])
router.add_api_route("/{strategy_id}/variations", get_strategy_variations, methods=["GET"])
router.add_api_route("/bots", list_bots, methods=["GET"])
router.add_api_route("/bots/{bot_id}", get_bot, methods=["GET"])
