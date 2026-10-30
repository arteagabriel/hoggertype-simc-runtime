#include <iostream>

extern "C"
{
const char* hoggertype_start( const char* json );
const char* hoggertype_advance_to( const char* json );
const char* hoggertype_cast( const char* json );
const char* hoggertype_get_metadata();
const char* hoggertype_get_state();
const char* hoggertype_reset();
}

int main()
{
  const char* starts[] = {
    R"({"durationMs":60000,"heroTalentId":"deathstalker","seed":42,"specializationId":"rogue.assassination"})",
    R"({"durationMs":60000,"heroTalentId":"fatebound","seed":42,"specializationId":"rogue.assassination"})",
    R"({"durationMs":60000,"heroTalentId":"trickster","seed":42,"specializationId":"rogue.outlaw"})",
    R"({"durationMs":60000,"heroTalentId":"fatebound","seed":42,"specializationId":"rogue.outlaw"})",
    R"({"durationMs":60000,"heroTalentId":"deathstalker","seed":42,"specializationId":"rogue.subtlety"})",
    R"({"durationMs":60000,"heroTalentId":"trickster","seed":42,"specializationId":"rogue.subtlety"})"
  };
  const char* casts[] = {
    R"({"spellId":"garrote"})",
    R"({"spellId":"garrote"})",
    R"({"spellId":"sinister_strike"})",
    R"({"spellId":"sinister_strike"})",
    R"({"spellId":"backstab"})",
    R"({"spellId":"backstab"})"
  };

  for ( int index = 0; index < 6; ++index )
  {
    std::cout << hoggertype_start( starts[ index ] ) << '\n';
    std::cout << hoggertype_get_metadata() << '\n';
    std::cout << hoggertype_get_state() << '\n';
    std::cout << hoggertype_cast( casts[ index ] ) << '\n';
    std::cout << hoggertype_advance_to( R"({"timeMs":1500})" ) << '\n';
    std::cout << hoggertype_get_state() << '\n';
    std::cout << hoggertype_reset() << '\n';
  }
}
