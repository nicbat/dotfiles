import requests
# import time

API_KEY = "2ee6ad2d9a45846b6d89f034fd746a1f"
CITY = "Seattle"
UNITS = "imperial"  # Use "imperial" for Fahrenheit
ICON_MAP = {
    "Clear": "󰖙",
    "Clouds": "󰖐",
    "Rain": "󰖖",
    "Drizzle": "󰖗",
    "Thunderstorm": "󰖓",
    "Snow": "󰖘",
    "Mist": "󰖑", # the same as fog
    "Smoke": "󰼸",
    "Haze": "󰼰",
    # "Dust": "🌪️",
    "Fog": "󰖑",
    # "Sand": "🏜️",
    # "Ash": "🌋",
    # "Squall": "💨",
    "Tornado": "󰼸",
    "Hail": "󰖒"
}

def get_weather():
    url = f"http://api.openweathermap.org/data/2.5/weather?q={CITY}&appid={API_KEY}&units={UNITS}"
    # success = False
    # while not success:
    try:
        response = requests.get(url)
        data = response.json()
        
        if response.status_code == 200:
            temp = round(data["main"]["temp"])
            condition = data["weather"][0]["main"]
            icon = ICON_MAP.get(condition, "")
            # success = True
            return {"temp": temp, "condition": condition, "icon": icon}
        # print(response)
        # else:
            # time.sleep(30)
        else:
            print(response)
            return {"temp": "?", "condition": "Error", "icon": ""}
    except Exception as e:
        pass
        return {"temp": "?", "condition": f"{e}", "icon": ""}
        # wait 1 minute
        # time.sleep(60)
    # finally:
    #     return {"temp": "N/A", "condition": "Error", "icon": ""}


def main():
    # print(f'{{"text": " N/A°F", "tooltip": "Error in {CITY}"}}')
    weather = get_weather()
    print(f'{{"text": "{weather["icon"]}  {weather["temp"]}°F", "tooltip": "{weather["condition"]} in {CITY}"}}')

if __name__ == "__main__":
    main()

