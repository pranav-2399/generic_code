swift
struct Person {
    var name: String
    var age: Int
}

var people = [
    Person(name: "John", age: 30),
    Person(name: "Jane", age: 25),
    Person(name: "Bob", age: 40)
]

print("The oldest person is \(people.max { $0.age < $1.age }?.name)")