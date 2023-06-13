import mysql.connector


def getDB(database="tele_video"):
    DB = mysql.connector.connect(
        host="localhost",
        user="root",
        password="root12345",
        database=database
    )
    return DB


def getData():
    db = getDB()
    cursor = db.cursor()
    q = "SELECT * FROM users"
    print(cursor)
    cursor.execute(q)

    result = cursor.fetchall()

    cursor.close()
    db.close()
    return result


def getUserData(userName):
    data = getData()
    for d in data:
        if d[1] == userName:
            return d[0]
    return "12345"


# getData()
