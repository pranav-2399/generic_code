using System;

class Program
{
    static void Main()
    {
        string randomString = GenerateRandomString(10);  // Generate a random string of length 10
        Console.WriteLine("Random String: " + randomString);
    }

    static string GenerateRandomString(int length)
    {
        Random rand = new Random();
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        char[] stringChars = new char[length];
        
        for (int i = 0; i < length; i++)
        {
            stringChars[i] = chars[rand.Next(chars.Length)];
        }

        return new string(stringChars);
    }
}
