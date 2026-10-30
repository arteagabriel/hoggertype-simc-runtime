#include "action/action.hpp"
#include "action/action_state.hpp"
#include "action/dot.hpp"
#include "buff/buff.hpp"
#include "class_modules/class_module.hpp"
#include "dbc/dbc.hpp"
#include "lib/rapidjson/document.h"
#include "lib/rapidjson/stringbuffer.h"
#include "lib/rapidjson/writer.h"
#include "player/player.hpp"
#include "player/action_priority_list.hpp"
#include "player/pet.hpp"
#include "player/stats.hpp"
#include "player/unique_gear.hpp"
#include "sim/cooldown.hpp"
#include "sim/event.hpp"
#include "sim/expressions.hpp"
#include "sim/sim.hpp"
#include "sim/sim_control.hpp"

#include <algorithm>
#include <array>
#include <fstream>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define HOGGERTYPE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define HOGGERTYPE_EXPORT
#endif

namespace
{
struct engine_t
{
  std::unique_ptr<sim_control_t> control;
  std::unique_ptr<sim_t> sim;
  player_t* player = nullptr;
  std::vector<action_t*> actions;
  std::string specialization_id;
  int duration_ms = 0;
  bool combat_started = false;

  ~engine_t()
  {
    if ( combat_started )
      sim->combat_end();
  }
};

std::unique_ptr<engine_t> engine;
std::string response_buffer;
bool simc_initialized = false;

using document_t = rapidjson::Document;
using allocator_t = document_t::AllocatorType;

struct specialization_t
{
  const char* id;
  const char* profile;
  const char* hero_one;
  const char* hero_two;
};

constexpr std::array specializations = {
  specialization_t{ "death-knight.frost", "/profiles/death-knight-frost.simc", "deathbringer", "rider_of_the_apocalypse" },
  specialization_t{ "death-knight.unholy", "/profiles/death-knight-unholy.simc", "rider_of_the_apocalypse", "sanlayn" },
  specialization_t{ "demon-hunter.devourer", "/profiles/demon-hunter-devourer.simc", "voidscarred", "annihilator" },
  specialization_t{ "demon-hunter.havoc", "/profiles/demon-hunter-havoc.simc", "felscarred", "aldrachi_reaver" },
  specialization_t{ "druid.balance", "/profiles/druid-balance.simc", "keeper_of_the_grove", "elunes_chosen" },
  specialization_t{ "druid.feral", "/profiles/druid-feral.simc", "wildstalker", "druid_of_the_claw" },
  specialization_t{ "evoker.augmentation", "/profiles/evoker-augmentation-chronowarden.simc", "chronowarden", "scalecommander" },
  specialization_t{ "evoker.devastation", "/profiles/evoker-devastation.simc", "scalecommander", "flameshaper" },
  specialization_t{ "hunter.beast-mastery", "/profiles/hunter-beast-mastery.simc", "pack_leader", "dark_ranger" },
  specialization_t{ "hunter.marksmanship", "/profiles/hunter-marksmanship.simc", "sentinel", "dark_ranger" },
  specialization_t{ "hunter.survival", "/profiles/hunter-survival.simc", "sentinel", "pack_leader" },
  specialization_t{ "mage.arcane", "/profiles/mage-arcane.simc", "spellslinger", "sunfury" },
  specialization_t{ "mage.fire", "/profiles/mage-fire.simc", "sunfury", "frostfire" },
  specialization_t{ "mage.frost", "/profiles/mage-frost.simc", "spellslinger", "frostfire" },
  specialization_t{ "monk.windwalker", "/profiles/monk-windwalker.simc", "shadopan", "conduit_of_the_celestials" },
  specialization_t{ "paladin.retribution", "/profiles/paladin-retribution.simc", "herald_of_the_sun", "templar" },
  specialization_t{ "priest.shadow", "/profiles/priest-shadow.simc", "voidweaver", "archon" },
  specialization_t{ "rogue.assassination", "/profiles/rogue-assassination.simc", "deathstalker", "fatebound" },
  specialization_t{ "rogue.outlaw", "/profiles/rogue-outlaw.simc", "trickster", "fatebound" },
  specialization_t{ "rogue.subtlety", "/profiles/rogue-subtlety.simc", "deathstalker", "trickster" },
  specialization_t{ "shaman.elemental", "/profiles/shaman-elemental.simc", "farseer", "stormbringer" },
  specialization_t{ "shaman.enhancement", "/profiles/shaman-enhancement.simc", "stormbringer", "totemic" },
  specialization_t{ "warlock.affliction", "/profiles/warlock-affliction.simc", "hellcaller", "soul_harvester" },
  specialization_t{ "warlock.demonology", "/profiles/warlock-demonology.simc", "diabolist", "soul_harvester" },
  specialization_t{ "warlock.destruction", "/profiles/warlock-destruction.simc", "diabolist", "hellcaller" },
  specialization_t{ "warrior.arms", "/profiles/warrior-arms.simc", "slayer", "colossus" },
  specialization_t{ "warrior.fury", "/profiles/warrior-fury.simc", "slayer", "mountain_thane" }
};

const specialization_t& find_specialization( std::string_view specialization_id )
{
  const auto found = std::find_if(
    specializations.begin(),
    specializations.end(),
    [ specialization_id ]( const specialization_t& specialization ) {
      return specialization.id == specialization_id;
    }
  );

  if ( found == specializations.end() )
    throw std::invalid_argument( "Unsupported specialization." );

  return *found;
}

void initialize_simc()
{
  if ( simc_initialized )
    return;

  dbc::init();
  module_t::init();
  unique_gear::register_hotfixes();
  unique_gear::register_special_effects();
  unique_gear::sort_special_effects();
  hotfix::apply();
  simc_initialized = true;
}

bool has_dedicated_hero_profiles( std::string_view specialization_id )
{
  return specialization_id == "evoker.augmentation" ||
         specialization_id == "evoker.devastation" ||
         specialization_id == "mage.arcane" ||
         specialization_id == "mage.fire" ||
         specialization_id == "paladin.retribution" ||
         specialization_id == "priest.shadow";
}

const char* profile_path(
  std::string_view specialization_id,
  std::string_view hero_talent_id
)
{
  if ( specialization_id == "evoker.augmentation" )
    return hero_talent_id == "chronowarden"
             ? "/profiles/evoker-augmentation-chronowarden.simc"
             : "/profiles/evoker-augmentation-scalecommander.simc";

  if ( specialization_id == "evoker.devastation" && hero_talent_id == "flameshaper" )
    return "/profiles/evoker-devastation-flameshaper.simc";

  if ( specialization_id == "mage.arcane" && hero_talent_id == "sunfury" )
    return "/profiles/mage-arcane-sunfury.simc";

  if ( specialization_id == "mage.fire" && hero_talent_id == "frostfire" )
    return "/profiles/mage-fire-frostfire.simc";

  if ( specialization_id == "paladin.retribution" && hero_talent_id == "templar" )
    return "/profiles/paladin-retribution-templar.simc";

  if ( specialization_id == "priest.shadow" && hero_talent_id == "archon" )
    return "/profiles/priest-shadow-archon.simc";

  return find_specialization( specialization_id ).profile;
}

bool supports_hero_talent(
  std::string_view specialization_id,
  std::string_view hero_talent_id
)
{
  const auto& specialization = find_specialization( specialization_id );

  return hero_talent_id == specialization.hero_one ||
         hero_talent_id == specialization.hero_two;
}

std::string read_profile(
  std::string_view specialization_id,
  std::string_view hero_talent_id
)
{
  std::ifstream input( profile_path( specialization_id, hero_talent_id ) );

  if ( !input.is_open() )
    throw std::runtime_error( "Unable to load the embedded specialization profile." );

  std::ostringstream profile;
  profile << input.rdbuf();

  std::string profile_text = profile.str();

  if ( specialization_id == "rogue.outlaw" )
  {
    std::istringstream profile_lines( profile_text );
    std::ostringstream filtered_profile;
    std::string line;

    while ( std::getline( profile_lines, line ) )
    {
      const bool is_precombat_action = line.rfind( "actions.precombat", 0 ) == 0;
      const bool is_player_controlled_cooldown =
        line.find( "/adrenaline_rush" ) != std::string::npos ||
        line.find( "/roll_the_bones" ) != std::string::npos;

      if ( is_precombat_action && is_player_controlled_cooldown )
        continue;

      filtered_profile << line << '\n';
    }

    profile_text = filtered_profile.str();
    profile_text += "\nactions+=/slice_and_dice\n";
  }

  if ( specialization_id == "mage.arcane" )
  {
    constexpr std::string_view action = "arcane_missiles,";
    constexpr std::string_view instant_option =
      "arcane_missiles,allow_arcane_missiles_delay=1,";
    std::string::size_type position = 0;

    while ( ( position = profile_text.find( action, position ) ) !=
            std::string::npos )
    {
      profile_text.replace( position, action.size(), instant_option );
      position += instant_option.size();
    }
  }

  if ( !has_dedicated_hero_profiles( specialization_id ) )
  {
    profile_text += "\nhero_talents=";
    profile_text += hero_talent_id;
    profile_text += '\n';
  }

  return profile_text;
}

document_t parse_request( const char* json )
{
  document_t request;
  request.Parse( json ? json : "{}" );

  if ( request.HasParseError() || !request.IsObject() )
    throw std::invalid_argument( "Invalid bridge request." );

  return request;
}

const char* serialize( document_t& response )
{
  rapidjson::StringBuffer buffer;
  rapidjson::Writer<rapidjson::StringBuffer> writer( buffer );
  response.Accept( writer );
  response_buffer.assign( buffer.GetString(), buffer.GetSize() );

  return response_buffer.c_str();
}

std::string describe_exception( const std::exception& error )
{
  std::string description = error.what();

  try
  {
    std::rethrow_if_nested( error );
  }
  catch ( const std::exception& nested )
  {
    description += ": " + describe_exception( nested );
  }
  catch ( ... )
  {
  }

  return description;
}

const char* error_response( const std::exception& error )
{
  document_t response( rapidjson::kObjectType );
  auto& allocator = response.GetAllocator();
  const std::string description = describe_exception( error );

  response.AddMember( "ok", false, allocator );
  response.AddMember(
    "error",
    rapidjson::Value( description.c_str(), allocator ),
    allocator
  );

  return serialize( response );
}

const char* empty_response()
{
  document_t response( rapidjson::kObjectType );
  auto& allocator = response.GetAllocator();

  response.AddMember( "ok", true, allocator );
  response.AddMember( "result", rapidjson::Value().SetNull(), allocator );

  return serialize( response );
}

void require_engine()
{
  if ( !engine || !engine->combat_started )
    throw std::runtime_error( "SimulationCraft combat has not started." );
}

void cancel_player_decision_events()
{
  event_t::cancel( engine->player->readying );
  event_t::cancel( engine->player->off_gcd );
  event_t::cancel( engine->player->cast_while_casting_poll_event );
}

void execute_without_player_actions( timespan_t until )
{
  auto* action_list = engine->player->active_action_list;

  if ( !action_list )
  {
    engine->sim->event_mgr.execute_until( until );
    cancel_player_decision_events();
    return;
  }

  auto foreground_actions = std::move( action_list->foreground_action_list );
  auto off_gcd_actions = std::move( action_list->off_gcd_actions );
  auto casting_actions = std::move( action_list->cast_while_casting_actions );

  try
  {
    engine->sim->event_mgr.execute_until( until );
    cancel_player_decision_events();
  }
  catch ( ... )
  {
    action_list->foreground_action_list = std::move( foreground_actions );
    action_list->off_gcd_actions = std::move( off_gcd_actions );
    action_list->cast_while_casting_actions = std::move( casting_actions );
    throw;
  }

  action_list->foreground_action_list = std::move( foreground_actions );
  action_list->off_gcd_actions = std::move( off_gcd_actions );
  action_list->cast_while_casting_actions = std::move( casting_actions );
}

void resolve_channel_immediately( action_t* action )
{
  if ( !action->channeled )
    return;

  dot_t* channel = action->get_dot( action->target );

  if ( !channel || !channel->is_ticking() )
    return;

  const int remaining_ticks = channel->ticks_left();
  const timespan_t now = engine->sim->current_time();
  action_t* tick_action = action->tick_action;
  const double travel_speed = tick_action ? tick_action->travel_speed : 0.0;
  const double travel_delay = tick_action ? tick_action->travel_delay : 0.0;
  const double min_travel_time = tick_action ? tick_action->min_travel_time : 0.0;

  if ( tick_action )
  {
    tick_action->travel_speed = 0.0;
    tick_action->travel_delay = 0.0;
    tick_action->min_travel_time = 0.0;
  }

  const auto restore_travel = [ = ]
  {
    if ( tick_action )
    {
      tick_action->travel_speed = travel_speed;
      tick_action->travel_delay = travel_delay;
      tick_action->min_travel_time = min_travel_time;
    }
  };

  event_t::cancel( channel->tick_event );

  for ( int tick = 0; tick < remaining_ticks; ++tick )
  {
    ++channel->current_tick;
    channel->tick();

    if ( !channel->is_ticking() )
    {
      restore_travel();
      return;
    }

    execute_without_player_actions( now );

    if ( !action->consume_cost_per_tick( *channel ) )
    {
      restore_travel();
      return;
    }
  }

  event_t::cancel( channel->end_event );
  channel->last_tick();
  restore_travel();
  cancel_player_decision_events();
}

double actor_damage( const player_t* player )
{
  double damage = 0.0;

  for ( const auto* stats : player->stats_list )
  {
    if ( stats->type == STATS_DMG )
      damage += stats->iteration_actual_amount();
  }

  return damage;
}

double player_damage( const player_t* player )
{
  double damage = actor_damage( player );

  for ( const auto* pet : player->pet_list )
    damage += actor_damage( pet );

  return damage;
}

double remains_ms( timespan_t remains )
{
  return std::max( 0.0, static_cast<double>( remains.total_millis() ) );
}

void add_resource(
  rapidjson::Value& resources,
  allocator_t& allocator,
  const char* name,
  resource_e resource,
  const std::vector<double>& segments = {}
)
{
  rapidjson::Value state( rapidjson::kObjectType );
  state.AddMember( "current", engine->player->resources.current[ resource ], allocator );
  state.AddMember( "max", engine->player->resources.max[ resource ], allocator );
  state.AddMember(
    "gained",
    engine->player->iteration_resource_gained[ resource ],
    allocator
  );
  state.AddMember(
    "overflowed",
    engine->player->iteration_resource_overflowed[ resource ],
    allocator
  );

  if ( !segments.empty() )
  {
    rapidjson::Value segment_values( rapidjson::kArrayType );

    for ( const double segment : segments )
      segment_values.PushBack( segment, allocator );

    state.AddMember( "segments", segment_values, allocator );
  }

  resources.AddMember( rapidjson::Value( name, allocator ), state, allocator );
}

std::vector<double> rune_segments()
{
  std::vector<double> segments;

  if ( engine->specialization_id != "death-knight.frost" &&
       engine->specialization_id != "death-knight.unholy" )
    return segments;

  for ( unsigned slot = 1; slot <= 6; ++slot )
  {
    const std::string expression = "rune.progress_" + std::to_string( slot );
    auto progress = engine->player->create_expression( expression );
    segments.push_back( std::clamp( progress->eval(), 0.0, 1.0 ) );
  }

  return segments;
}

void add_expression_resource(
  rapidjson::Value& resources,
  allocator_t& allocator,
  const char* name,
  const char* expression,
  double maximum
)
{
  auto value = engine->player->create_expression( expression );
  rapidjson::Value state( rapidjson::kObjectType );

  state.AddMember( "current", value->eval(), allocator );
  state.AddMember( "max", maximum, allocator );
  state.AddMember( "gained", 0.0, allocator );
  state.AddMember( "overflowed", 0.0, allocator );
  resources.AddMember( rapidjson::Value( name, allocator ), state, allocator );
}

void add_action_times(
  rapidjson::Value& cooldowns,
  rapidjson::Value& charges,
  rapidjson::Value& dots,
  rapidjson::Value& refreshable_dots,
  allocator_t& allocator
)
{
  for ( auto* action : engine->actions )
  {
    const std::string& key = action->name_str;
    rapidjson::Value cooldown_key( key.c_str(), allocator );
    rapidjson::Value dot_key( key.c_str(), allocator );
    cooldowns.AddMember(
      cooldown_key,
      remains_ms( action->cooldown->remains() ),
      allocator
    );

    if ( action->cooldown->charges > 1 )
    {
      rapidjson::Value charge_state( rapidjson::kObjectType );
      rapidjson::Value charge_key( key.c_str(), allocator );
      charge_state.AddMember(
        "current",
        action->cooldown->current_charge,
        allocator
      );
      charge_state.AddMember( "max", action->cooldown->charges, allocator );
      charges.AddMember(
        charge_key,
        charge_state,
        allocator
      );
    }

    dot_t* dot = action->get_dot( engine->sim->target );
    dot_t* self_dot = action->get_dot( engine->player );

    if ( self_dot && self_dot->is_ticking() )
      dot = self_dot;

    dots.AddMember(
      dot_key,
      dot ? remains_ms( dot->remains() ) : 0.0,
      allocator
    );

    bool refreshable = false;

    if ( dot && dot->is_ticking() && dot->current_action )
    {
      std::unique_ptr<action_state_t> state(
        dot->current_action->get_state()
      );
      dot->current_action->snapshot_state(
        state.get(),
        result_amount_type::DMG_OVER_TIME
      );
      const timespan_t new_duration =
        dot->current_action->composite_dot_duration( state.get() );
      refreshable = dot->current_action->dot_refreshable(
        dot,
        new_duration
      );
    }

    rapidjson::Value refreshable_key( key.c_str(), allocator );
    refreshable_dots.AddMember(
      refreshable_key,
      refreshable,
      allocator
    );
  }
}

void collect_actions()
{
  for ( const auto* list : engine->player->action_priority_list )
  {
    if ( list->name_str == "precombat" )
      continue;

    for ( auto* action : list->foreground_action_list )
    {
      if ( !action || action->background || action->proc || !action->data().id() )
        continue;

      action->base_execute_time = 0_ms;
      action->trigger_gcd = 0_ms;

      engine->actions.push_back( action );
    }
  }
}

void filter_precombat_actions()
{
  static const std::set<std::string> setup_actions = {
    "apply_poison", "arcane_intellect", "battle_stance", "berserker_stance",
    "cat_form", "moonkin_form", "shadowform", "stealth", "prowl",
    "flametongue_weapon", "windfury_weapon", "lightning_shield",
    "thunderstrike_ward", "blessing_of_the_bronze", "mark_of_the_wild",
    "battle_shout", "power_word_fortitude", "skyfury",
    "summon_pet", "summon_water_elemental", "raise_dead",
    "grimoire_of_sacrifice", "snapshot_stats", "variable",
    "flask", "food", "augmentation", "apply_weapon_oil", "potion"
  };

  for ( auto* player : engine->sim->player_no_pet_list )
  {
    auto& actions = player->precombat_action_list;
    actions.erase(
      std::remove_if( actions.begin(), actions.end(), []( const action_t* action ) {
        return !setup_actions.count( action->name_str );
      } ),
      actions.end()
    );
  }
}

action_t* find_supported_action( std::string_view name )
{
  action_t* fallback = nullptr;

  for ( auto* action : engine->actions )
  {
    if ( action->name_str != name )
      continue;

    if ( !fallback )
      fallback = action;

    if ( action->action_ready() )
      return action;
  }

  return fallback;
}

void add_aura(
  rapidjson::Value& auras,
  allocator_t& allocator,
  const buff_t* buff
)
{
  if ( !buff || buff->check() <= 0 )
    return;

  rapidjson::Value aura( rapidjson::kObjectType );
  const auto& data = buff->data_reporting();
  const unsigned spell_id = data.id();
  const char* display_name = data.name_cstr();

  aura.AddMember( "spellId", spell_id, allocator );
  aura.AddMember(
    "name",
    rapidjson::Value(
      display_name && display_name[ 0 ] ? display_name : buff->name_str.c_str(),
      allocator
    ),
    allocator
  );
  aura.AddMember( "stacks", buff->check(), allocator );
  aura.AddMember( "maxStacks", buff->max_stack(), allocator );
  aura.AddMember( "remainingMs", remains_ms( buff->remains() ), allocator );
  auras.AddMember(
    rapidjson::Value( buff->name_str.c_str(), allocator ),
    aura,
    allocator
  );
}

void add_auras(
  rapidjson::Value& buffs,
  rapidjson::Value& debuffs,
  allocator_t& allocator
)
{
  for ( const auto* buff : engine->player->buff_list )
    add_aura( buffs, allocator, buff );

  for ( const auto* debuff : engine->sim->target->buff_list )
  {
    if ( debuff->source == engine->player )
      add_aura( debuffs, allocator, debuff );
  }
}

bool spell_ready( action_t* action )
{
  if ( action->cooldown->down() )
    return false;

  // Class overrides of action_ready() can contain actual cast requirements.
  // Temporarily remove APL expressions while retaining those virtual checks.
  auto condition = std::move( action->if_expr );
  auto target_condition = std::move( action->target_if_expr );
  const auto target_mode = action->target_if_mode;
  action->target_if_mode = action_t::TARGET_IF_NONE;
  const int moving = action->option.moving;
  action->option.moving = -1;

  try
  {
    const bool ready = action->action_ready();
    action->if_expr = std::move( condition );
    action->target_if_expr = std::move( target_condition );
    action->target_if_mode = target_mode;
    action->option.moving = moving;
    return ready;
  }
  catch ( ... )
  {
    action->if_expr = std::move( condition );
    action->target_if_expr = std::move( target_condition );
    action->target_if_mode = target_mode;
    action->option.moving = moving;
    throw;
  }
}

void add_resource_affordability(
  rapidjson::Value& affordability,
  rapidjson::Value& readiness,
  allocator_t& allocator
)
{
  std::map<std::string, bool> affordable_by_action;
  std::map<std::string, bool> ready_by_action;

  for ( auto* action : engine->actions )
  {
    const bool ready = spell_ready( action );
    ready_by_action[ action->name_str ] = ready_by_action[ action->name_str ] || ready;
    const bool affordable = action->cost_affordable();
    auto [ entry, inserted ] = affordable_by_action.emplace(
      action->name_str,
      affordable
    );

    if ( !inserted )
      entry->second = entry->second || affordable;
  }

  for ( const auto& [ action_name, affordable ] : affordable_by_action )
  {
    rapidjson::Value action_key( action_name.c_str(), allocator );
    rapidjson::Value affordability_value( affordable );

    affordability.AddMember(
      action_key,
      affordability_value,
      allocator
    );
  }

  for ( const auto& [ action_name, ready ] : ready_by_action )
  {
    rapidjson::Value key( action_name.c_str(), allocator );
    rapidjson::Value value( ready );
    readiness.AddMember( key, value, allocator );
  }
}

document_t metadata_response()
{
  require_engine();

  document_t response( rapidjson::kObjectType );
  auto& allocator = response.GetAllocator();
  rapidjson::Value result( rapidjson::kObjectType );
  rapidjson::Value abilities( rapidjson::kArrayType );
  std::set<std::string> seen;

  for ( auto* action : engine->actions )
  {
    if ( !seen.emplace( action->name_str ).second )
      continue;

    rapidjson::Value ability( rapidjson::kObjectType );
    rapidjson::Value costs( rapidjson::kObjectType );
    const auto& data = action->data_reporting();
    const auto& text = engine->player->dbc->spell_text( data.id() );
    const resource_e resource = action->current_resource();
    const double cost = action->cost();

    ability.AddMember(
      "id",
      rapidjson::Value( action->name_str.c_str(), allocator ),
      allocator
    );
    ability.AddMember( "spellId", data.id(), allocator );
    ability.AddMember(
      "name",
      rapidjson::Value( data.name_cstr(), allocator ),
      allocator
    );
    ability.AddMember(
      "description",
      rapidjson::Value( text.desc() ? text.desc() : "", allocator ),
      allocator
    );

    if ( resource != RESOURCE_NONE && cost > 0.0 )
    {
      const std::string resource_name( util::resource_type_string( resource ) );
      rapidjson::Value resource_key( resource_name.c_str(), allocator );
      costs.AddMember(
        resource_key,
        cost,
        allocator
      );
    }

    ability.AddMember( "resourceCosts", costs, allocator );
    abilities.PushBack( ability, allocator );
  }

  result.AddMember( "abilities", abilities, allocator );
  response.AddMember( "ok", true, allocator );
  response.AddMember( "result", result, allocator );

  return response;
}

document_t state_response()
{
  require_engine();

  document_t response( rapidjson::kObjectType );
  auto& allocator = response.GetAllocator();
  rapidjson::Value result( rapidjson::kObjectType );
  rapidjson::Value damage( rapidjson::kObjectType );
  rapidjson::Value resources( rapidjson::kObjectType );
  rapidjson::Value cooldowns( rapidjson::kObjectType );
  rapidjson::Value charges( rapidjson::kObjectType );
  rapidjson::Value dots( rapidjson::kObjectType );
  rapidjson::Value refreshable_dots( rapidjson::kObjectType );
  rapidjson::Value buffs( rapidjson::kObjectType );
  rapidjson::Value debuffs( rapidjson::kObjectType );
  rapidjson::Value resource_affordability( rapidjson::kObjectType );
  rapidjson::Value ability_readiness( rapidjson::kObjectType );

  const double time_ms = engine->sim->current_time().total_millis();
  const double total_damage = player_damage( engine->player );

  damage.AddMember( "total", total_damage, allocator );
  damage.AddMember(
    "dps",
    time_ms > 0.0 ? total_damage / ( time_ms / 1000.0 ) : 0.0,
    allocator
  );

  add_resource( resources, allocator, "mana", RESOURCE_MANA );
  add_resource( resources, allocator, "rage", RESOURCE_RAGE );
  add_resource( resources, allocator, "focus", RESOURCE_FOCUS );
  add_resource( resources, allocator, "energy", RESOURCE_ENERGY );
  add_resource( resources, allocator, "runic_power", RESOURCE_RUNIC_POWER );
  add_resource( resources, allocator, "soul_shard", RESOURCE_SOUL_SHARD );
  add_resource( resources, allocator, "astral_power", RESOURCE_ASTRAL_POWER );
  add_resource( resources, allocator, "holy_power", RESOURCE_HOLY_POWER );
  add_resource( resources, allocator, "maelstrom", RESOURCE_MAELSTROM );
  add_resource( resources, allocator, "chi", RESOURCE_CHI );
  add_resource( resources, allocator, "insanity", RESOURCE_INSANITY );
  add_resource( resources, allocator, "fury", RESOURCE_FURY );
  add_resource(
    resources,
    allocator,
    "rune",
    RESOURCE_RUNE,
    rune_segments()
  );
  add_resource( resources, allocator, "combo_points", RESOURCE_COMBO_POINT );
  add_resource( resources, allocator, "essence", RESOURCE_ESSENCE );

  if ( engine->specialization_id == "mage.arcane" )
    add_expression_resource(
      resources,
      allocator,
      "arcane_charge",
      "buff.arcane_charge.stack",
      4.0
    );

  if ( engine->specialization_id == "demon-hunter.devourer" )
    add_expression_resource(
      resources,
      allocator,
      "souls",
      "soul_fragments",
      10.0
    );
  add_action_times(
    cooldowns,
    charges,
    dots,
    refreshable_dots,
    allocator
  );
  add_auras( buffs, debuffs, allocator );
  add_resource_affordability( resource_affordability, ability_readiness, allocator );

  result.AddMember( "timeMs", time_ms, allocator );
  result.AddMember( "damage", damage, allocator );
  result.AddMember( "resources", resources, allocator );
  result.AddMember(
    "gcdRemainingMs",
    remains_ms( engine->player->gcd_ready - engine->sim->current_time() ),
    allocator
  );
  result.AddMember( "buffs", buffs, allocator );
  result.AddMember( "debuffs", debuffs, allocator );
  result.AddMember( "dots", dots, allocator );
  result.AddMember( "refreshableDots", refreshable_dots, allocator );
  result.AddMember( "cooldowns", cooldowns, allocator );
  result.AddMember( "charges", charges, allocator );
  result.AddMember( "abilityReadiness", ability_readiness, allocator );
  result.AddMember(
    "resourceAffordability",
    resource_affordability,
    allocator
  );

  response.AddMember( "ok", true, allocator );
  response.AddMember( "result", result, allocator );

  return response;
}

const char* rejected_cast( const char* reason )
{
  document_t response( rapidjson::kObjectType );
  auto& allocator = response.GetAllocator();
  rapidjson::Value result( rapidjson::kObjectType );

  result.AddMember( "status", "rejected", allocator );
  result.AddMember( "reason", rapidjson::Value( reason, allocator ), allocator );
  response.AddMember( "ok", true, allocator );
  response.AddMember( "result", result, allocator );

  return serialize( response );
}

} // namespace

extern "C"
{
HOGGERTYPE_EXPORT const char* hoggertype_start( const char* json )
{
  try
  {
    const document_t request = parse_request( json );

    if ( !request.HasMember( "specializationId" ) ||
         !request[ "specializationId" ].IsString() )
      throw std::invalid_argument( "specializationId is required." );

    if ( !request.HasMember( "heroTalentId" ) ||
         !request[ "heroTalentId" ].IsString() )
      throw std::invalid_argument( "heroTalentId is required." );

    if ( !request.HasMember( "durationMs" ) || !request[ "durationMs" ].IsInt() ||
         !request.HasMember( "seed" ) || !request[ "seed" ].IsUint() )
      throw std::invalid_argument( "durationMs and seed are required." );

    initialize_simc();
    engine.reset();
    engine = std::make_unique<engine_t>();
    engine->duration_ms = request[ "durationMs" ].GetInt();
    engine->specialization_id = request[ "specializationId" ].GetString();
    engine->control = std::make_unique<sim_control_t>();
    const std::string_view specialization_id(
      request[ "specializationId" ].GetString()
    );
    const std::string_view hero_talent_id(
      request[ "heroTalentId" ].GetString()
    );

    if ( !supports_hero_talent( specialization_id, hero_talent_id ) )
      throw std::invalid_argument(
        "Hero talent is not available for this specialization."
      );

    engine->control->options.parse_text(
      read_profile( specialization_id, hero_talent_id )
    );
    engine->control->options.add(
      "global",
      "max_time",
      std::to_string( engine->duration_ms / 1000.0 )
    );
    engine->control->options.add(
      "global",
      "seed",
      std::to_string( request[ "seed" ].GetUint() )
    );
    engine->control->options.add( "global", "iterations", "1" );
    engine->control->options.add( "global", "threads", "1" );
    engine->control->options.add( "global", "fixed_time", "1" );
    engine->control->options.add( "global", "vary_combat_length", "0" );
    engine->control->options.add( "global", "desired_targets", "1" );
    engine->control->options.add( "global", "optimal_raid", "1" );
    engine->control->options.add( "global", "override.bloodlust", "1" );
    engine->control->options.add( "global", "calculate_scale_factors", "0" );
    engine->control->options.add( "global", "report_details", "0" );

    engine->sim = std::make_unique<sim_t>();
    engine->sim->setup( engine->control.get() );
    engine->sim->init();
    filter_precombat_actions();
    engine->sim->activate_actors();
    ++engine->sim->current_iteration;
    engine->sim->combat_begin();
    engine->combat_started = true;

    if ( engine->sim->player_no_pet_list.empty() )
      throw std::runtime_error( "The bridge requires a player." );

    engine->player = engine->sim->player_no_pet_list[ 0 ];
    collect_actions();
    cancel_player_decision_events();
    execute_without_player_actions( 0_ms );

    return empty_response();
  }
  catch ( const std::exception& error )
  {
    engine.reset();
    return error_response( error );
  }
}

HOGGERTYPE_EXPORT const char* hoggertype_advance_to( const char* json )
{
  try
  {
    require_engine();
    const document_t request = parse_request( json );

    if ( !request.HasMember( "timeMs" ) || !request[ "timeMs" ].IsNumber() )
      throw std::invalid_argument( "timeMs is required." );

    const double requested_ms = request[ "timeMs" ].GetDouble();
    const double current_ms = engine->sim->current_time().total_millis();

    if ( requested_ms < current_ms )
      throw std::invalid_argument( "SimulationCraft time cannot move backwards." );

    const double bounded_ms = std::min<double>( requested_ms, engine->duration_ms );
    execute_without_player_actions( timespan_t::from_millis( bounded_ms ) );

    return empty_response();
  }
  catch ( const std::exception& error )
  {
    return error_response( error );
  }
}

HOGGERTYPE_EXPORT const char* hoggertype_cast( const char* json )
{
  try
  {
    require_engine();
    const document_t request = parse_request( json );

    if ( !request.HasMember( "spellId" ) || !request[ "spellId" ].IsString() )
      throw std::invalid_argument( "spellId is required." );

    const std::string_view spell_id( request[ "spellId" ].GetString() );

    action_t* action = find_supported_action( spell_id );

    if ( !action )
      return rejected_cast( "Ability is unavailable in the active profile" );

    const timespan_t now = engine->sim->current_time();

    if ( action->cooldown->down() )
      return rejected_cast( "On cooldown" );

    if ( !action->cost_affordable() )
      return rejected_cast( "Not enough resources" );

    if ( !spell_ready( action ) )
      return rejected_cast( "Ability is not ready" );

    cancel_player_decision_events();
    engine->player->executing = action;
    action->time_to_execute = 0_ms;
    action->execute_event = action->start_action_execute_event( 0_ms );
    execute_without_player_actions( now );
    resolve_channel_immediately( action );

    document_t response( rapidjson::kObjectType );
    auto& allocator = response.GetAllocator();
    rapidjson::Value result( rapidjson::kObjectType );

    result.AddMember( "status", "executed", allocator );
    response.AddMember( "ok", true, allocator );
    response.AddMember( "result", result, allocator );

    return serialize( response );
  }
  catch ( const std::exception& error )
  {
    return error_response( error );
  }
}

HOGGERTYPE_EXPORT const char* hoggertype_get_state()
{
  try
  {
    document_t response = state_response();
    return serialize( response );
  }
  catch ( const std::exception& error )
  {
    return error_response( error );
  }
}

HOGGERTYPE_EXPORT const char* hoggertype_get_metadata()
{
  try
  {
    document_t response = metadata_response();
    return serialize( response );
  }
  catch ( const std::exception& error )
  {
    return error_response( error );
  }
}

HOGGERTYPE_EXPORT const char* hoggertype_reset()
{
  try
  {
    engine.reset();
    return empty_response();
  }
  catch ( const std::exception& error )
  {
    return error_response( error );
  }
}
}
