import sys
from urllib.error import URLError
from urllib.request import urlopen


try:
    with urlopen(sys.argv[1], timeout=2) as response:
        sys.exit(0 if response.status == 200 else 1)
except (IndexError, URLError):
    sys.exit(1)
