from astral import LocationInfo, moon
from astral.sun import sun
import math
import datetime

city = LocationInfo()
city.name = 'Seattle'

def get_sunrise_sunset():
    s = sun(city.observer, date=datetime.date.today())
    sunrise, sunset = s['sunrise'], s['sunset']
    sunrise = sunrise.strftime("%H:%M")
    sunset = sunset.strftime("%H:%M")
    return sunrise, sunset

# city = LocationInfo("Seattle", "")

# Define emojis for moon phases
PHASE_EMOJIS = {
    "New Moon": "󰽤",
    "Waxing Crescent": "󰽧",
    "First Quarter": "󰽡",
    "Waxing Gibbous": "󰽨",
    "Full Moon": "",
    "Waning Gibbous": "󰽦",
    "Last Quarter": "󰽣",
    "Waning Crescent": "󰽥",
}

def get_moon_phase():
    phase = moon.phase()  # Get the current moon phase as a number (0-29.53)
    if phase < 1:
        return "New Moon"
    elif phase < 7:
        return "Waxing Crescent"
    elif phase < 8:
        return "First Quarter"
    elif phase < 15:
        return "Waxing Gibbous"
    elif phase < 16:
        return "Full Moon"
    elif phase < 22:
        return "Waning Gibbous"
    elif phase < 23:
        return "Last Quarter"
    elif phase < 29:
        return "Waning Crescent"
    else:
        return "New Moon"

def get_lunar_day():
    phase = moon.phase()  # Moon phase as a number (0-29.53)
    lunar_day = int(math.floor(phase)) + 1  # Add 1 because days start at 1, not 0
    return lunar_day

def main():
    sunrise, sunset = get_sunrise_sunset()
    rise_emoji = ""
    set_emoji = ""
    phase_name = get_moon_phase()
    emoji = PHASE_EMOJIS[phase_name]
    day = get_lunar_day()
    
    # Output JSON for Waybar
    # print(f'{{"text": "{emoji} L{day}", "tooltip": "{phase_name}"}}')
    print(f'{{"text": "{rise_emoji} {sunrise} | {set_emoji} {sunset} | {emoji} L{day}", "tooltip":"Sunrise: {sunrise} | Sunset: {sunset} | {phase_name}"}}')

if __name__ == "__main__":
    main()

